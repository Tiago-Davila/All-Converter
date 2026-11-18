"""Herramientas MCP para convertir archivos entre formatos y listar las conversiones."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Final, Protocol

import anyio.to_thread
from pydantic import BaseModel

from convertitodo_mcp.convert.medios import ffmpeg_disponible
from convertitodo_mcp.convert.registro import (
    TABLA,
    TIPOS_ACEPTADOS,
    Conversion,
    OpcionesConversion,
    TipoOrigen,
    cargar_origen,
    convertir_datos,
    destinos_para,
    validar_conversion,
)
from convertitodo_mcp.convert.tipos import SalidaConversion
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
    herramienta_segura,
)
from convertitodo_mcp.limites import ejecutar_con_limite
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen
from convertitodo_mcp.storage.rutas import sanear_nombre

# Salida total permitida: varias veces el tope de entrada, porque PDF a imágenes o dividir
# pueden multiplicar el peso del original sin que eso sea un abuso.
FACTOR_SALIDA_MAX: Final = 4
MAX_ARCHIVOS_SALIDA: Final = 200

_ALIAS_FORMATO: Final = {"jpeg": "jpg", "markdown": "md", "excel": "xlsx", "word": "docx"}


class ArchivoConvertido(BaseModel):
    id: str
    nombre: str
    tamano: int
    url: str


class ResultadoConversion(BaseModel):
    origen: str
    destino: str
    archivos: list[ArchivoConvertido]
    aviso: str | None


class DestinoListado(BaseModel):
    destino: str
    descripcion: str
    opciones: list[str]
    fidelidad_parcial: bool
    disponible: bool


class OrigenListado(BaseModel):
    origen: str
    destinos: list[DestinoListado]


class ResultadoListado(BaseModel):
    ffmpeg_disponible: bool
    archivo: str | None
    tipo: str | None
    conversiones: list[OrigenListado]
    nota: str | None = None


class HerramientaConvertir(Protocol):
    def __call__(
        self, archivo: str, formato_destino: str, opciones: OpcionesConversion | None = None
    ) -> Awaitable[ResultadoConversion]: ...


class HerramientaListar(Protocol):
    def __call__(self, archivo: str | None = None) -> Awaitable[ResultadoListado]: ...


# Pasa a minúsculas, quita el punto inicial y resuelve alias frecuentes (jpeg, word, excel…).
def normalizar_formato(formato: str) -> str:
    limpio = formato.strip().lower().lstrip(".")
    if not limpio:
        raise ErrorArgumento(
            "El formato de destino está vacío.",
            "indicá formato_destino, por ejemplo «pdf»; llamá a listar_conversiones para ver "
            "las opciones.",
        )
    return _ALIAS_FORMATO.get(limpio, limpio)


# Valida los topes de salida antes de guardar nada.
def _verificar_salidas(salidas: list[SalidaConversion], config: Configuracion) -> None:
    if not salidas:
        raise ErrorFormatoNoSoportado(
            "La conversión no produjo ningún archivo.", "verificá que el archivo tenga contenido."
        )
    if len(salidas) > MAX_ARCHIVOS_SALIDA:
        raise ErrorLimiteExcedido(
            f"La conversión generaría {len(salidas)} archivos; el máximo es {MAX_ARCHIVOS_SALIDA}.",
            "pedí menos páginas con las opciones «paginas» o «rangos».",
        )
    total = sum(len(s.datos) for s in salidas)
    tope = config.max_bytes * FACTOR_SALIDA_MAX
    if total > tope:
        raise ErrorLimiteExcedido(
            f"El resultado pesaría {total / 1048576:.2f} MB y el máximo permitido es "
            f"{tope // 1048576} MB.",
            "convertí menos páginas o usá una calidad o resolución menores.",
        )


# Guarda las salidas y, si algo falla a mitad, borra las ya guardadas.
def _guardar(salidas: list[SalidaConversion], almacen: Almacen) -> list[ArchivoConvertido]:
    guardados: list[ArchivoConvertido] = []
    try:
        for salida in salidas:
            archivo = almacen.guardar_salida(sanear_nombre(salida.nombre), salida.datos)
            guardados.append(
                ArchivoConvertido(
                    id=archivo.id,
                    nombre=archivo.nombre,
                    tamano=archivo.tamano,
                    url=f"/files/{archivo.id}",
                )
            )
    except BaseException:
        for guardado in guardados:
            almacen.borrar(guardado.id)
        raise
    return guardados


def crear_herramienta_convertir(almacen: Almacen, config: Configuracion) -> HerramientaConvertir:
    @herramienta_segura
    async def convertir(
        archivo: str, formato_destino: str, opciones: OpcionesConversion | None = None
    ) -> ResultadoConversion:
        """Convierte un archivo subido a otro formato y devuelve los archivos nuevos."""
        destino = normalizar_formato(formato_destino)
        opciones = opciones or OpcionesConversion()

        def trabajar() -> tuple[TipoOrigen, Conversion, list[SalidaConversion]]:
            nombre, origen, datos = cargar_origen(archivo, almacen, config)
            conversion = validar_conversion(origen, destino, opciones)
            adicionales: list[tuple[TipoOrigen, bytes]] = []
            for identificador in opciones.archivos_adicionales:
                _, tipo, contenido = cargar_origen(identificador, almacen, config)
                adicionales.append((tipo, contenido))
            salidas = convertir_datos(
                nombre,
                origen,
                datos,
                destino,
                opciones,
                adicionales=adicionales,
                almacen=almacen,
                config=config,
            )
            return origen, conversion, salidas

        origen, conversion, salidas = await ejecutar_con_limite(
            trabajar, config.timeout_s, que="la conversión"
        )
        _verificar_salidas(salidas, config)
        archivos = await anyio.to_thread.run_sync(_guardar, salidas, almacen)
        return ResultadoConversion(
            origen=origen,
            destino=destino,
            archivos=archivos,
            aviso=(
                f"Fidelidad parcial: {conversion.nota_fidelidad}"
                if conversion.fidelidad_parcial
                else None
            ),
        )

    return convertir


# Agrupa la tabla por origen, marcando como no disponibles las que necesitan ffmpeg ausente.
def _listar(origenes: list[str], hay_ffmpeg: bool) -> list[OrigenListado]:
    grupos: list[OrigenListado] = []
    for origen in origenes:
        destinos = [
            DestinoListado(
                destino=c.destino,
                descripcion=c.descripcion,
                opciones=list(c.opciones),
                fidelidad_parcial=c.fidelidad_parcial,
                disponible=hay_ffmpeg or not c.requiere_ffmpeg,
            )
            for c in TABLA
            if c.origen == origen
        ]
        grupos.append(OrigenListado(origen=origen, destinos=destinos))
    return grupos


def crear_herramienta_listar(almacen: Almacen, config: Configuracion) -> HerramientaListar:
    @herramienta_segura
    async def listar_conversiones(archivo: str | None = None) -> ResultadoListado:
        """Lista las conversiones posibles, de todos los tipos o del archivo indicado."""

        def consultar() -> ResultadoListado:
            hay_ffmpeg = ffmpeg_disponible() is not None
            if archivo is None:
                return ResultadoListado(
                    ffmpeg_disponible=hay_ffmpeg,
                    archivo=None,
                    tipo=None,
                    conversiones=_listar(list(TIPOS_ACEPTADOS), hay_ffmpeg),
                )
            _, tipo, _ = cargar_origen(archivo, almacen, config)
            nota = None
            if tipo == "md":
                nota = "Markdown no se convierte aquí: usá crear_pdf o crear_docx con markdown."
            return ResultadoListado(
                ffmpeg_disponible=hay_ffmpeg,
                archivo=archivo,
                tipo=tipo,
                conversiones=_listar([tipo] if destinos_para(tipo) else [], hay_ffmpeg),
                nota=nota,
            )

        return await ejecutar_con_limite(
            consultar, config.timeout_s, que="la consulta de conversiones"
        )

    return listar_conversiones
