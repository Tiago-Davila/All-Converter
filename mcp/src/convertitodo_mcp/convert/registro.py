"""Detección del tipo de origen y tabla única de conversiones disponibles."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field

from convertitodo_mcp.convert.imagenes import (
    FormatoImagen,
    convertir_imagen,
    detectar_formato_imagen,
)
from convertitodo_mcp.convert.medios import (
    FormatoAudio,
    convertir_audio,
    detectar_medio,
    extraer_audio,
)
from convertitodo_mcp.convert.pdf_imagenes import imagenes_a_pdf, pdf_a_imagenes
from convertitodo_mcp.convert.pdf_paginas import dividir_pdf, rotar_pdf, unir_pdfs
from convertitodo_mcp.convert.pdf_texto import pdf_a_docx, pdf_a_markdown
from convertitodo_mcp.convert.planillas import FormatoPlanilla, convertir_planilla
from convertitodo_mcp.convert.tipos import SalidaConversion
from convertitodo_mcp.convert.word import docx_a_pdf, docx_a_xlsx
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
)
from convertitodo_mcp.limites import verificar_tamano
from convertitodo_mcp.read.deteccion import detectar_tipo, validar_paquete
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.rutas import sanear_nombre

TipoOrigen = Literal[
    "pdf",
    "docx",
    "xlsx",
    "csv",
    "json",
    "md",
    "png",
    "jpg",
    "webp",
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "mp4",
]
TIPOS_ACEPTADOS: tuple[str, ...] = get_args(TipoOrigen)

_EXTENSIONES_TEXTO: dict[str, TipoOrigen] = {
    ".csv": "csv",
    ".json": "json",
    ".md": "md",
    ".markdown": "md",
}
PlanillaDestino = Literal["xlsx", "csv", "json", "pdf"]
_IMAGENES: tuple[FormatoImagen, ...] = ("png", "jpg", "webp")
_AUDIOS: tuple[FormatoAudio, ...] = ("mp3", "wav", "ogg", "m4a")
_OPERACIONES_PDF = ("unir", "dividir", "rotar")
# Opciones que acepta cada operación de pdf → pdf (además de `operacion`).
_OPCIONES_OPERACION: dict[str, tuple[str, ...]] = {
    "unir": ("archivos_adicionales",),
    "dividir": ("rangos",),
    "rotar": ("grados", "paginas"),
}
_CAMPOS_OPCION = (
    "operacion",
    "archivos_adicionales",
    "rangos",
    "paginas",
    "grados",
    "dpi",
    "calidad",
    "ancho_maximo",
)


# Opciones de `convertir`; cada conversión acepta solo algunas y rechaza el resto con un error.
class OpcionesConversion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operacion: Literal["unir", "dividir", "rotar"] | None = Field(
        default=None, description="Solo PDF a PDF (obligatoria): unir, dividir o rotar."
    )
    archivos_adicionales: list[str] = Field(
        default_factory=list,
        description="Ids extra: PDF a unir tras el principal, o imágenes extra para un PDF.",
    )
    rangos: str | None = Field(
        default=None,
        description='Páginas a separar al dividir, por ejemplo "1-3,5". Vacío: una por página.',
    )
    paginas: str | None = Field(
        default=None, description='Páginas a usar, por ejemplo "1-3,5". Vacío: todas.'
    )
    grados: Literal[90, 180, 270] | None = Field(
        default=None, description="Rotación horaria al rotar (obligatoria): 90, 180 o 270."
    )
    dpi: int | None = Field(
        default=None, description="Resolución al pasar PDF a imágenes (36-300)."
    )
    calidad: int | None = Field(default=None, description="Calidad de JPG o WebP (1-100).")
    ancho_maximo: int | None = Field(
        default=None, description="Ancho máximo en píxeles de la imagen resultante."
    )


# Datos que recibe cada función de conversión; el nombre base ya viene saneado y sin extensión.
@dataclass(frozen=True, slots=True)
class _Contexto:
    base: str
    datos: bytes
    opciones: OpcionesConversion
    adicionales: Sequence[tuple[TipoOrigen, bytes]]
    almacen: Almacen
    config: Configuracion


# Entrada de la tabla: describe la conversión y sabe ejecutarla (única fuente de verdad).
@dataclass(frozen=True, slots=True)
class Conversion:
    origen: TipoOrigen
    destino: str
    descripcion: str
    opciones: tuple[str, ...]
    fidelidad_parcial: bool
    requiere_ffmpeg: bool
    ejecutar: Callable[[_Contexto], list[SalidaConversion]] = field(repr=False, compare=False)
    nota_fidelidad: str = ""


# Devuelve las opciones con valor, para compararlas con las que acepta la conversión.
def _presentes(opciones: OpcionesConversion) -> list[str]:
    return [campo for campo in _CAMPOS_OPCION if getattr(opciones, campo) not in (None, [])]


# Argumentos opcionales con valor: así los valores por defecto siguen siendo los de cada módulo.
# Any: el conjunto de argumentos varía por conversión y se valida en cada módulo.
def _kw(opciones: OpcionesConversion, *campos: str) -> dict[str, Any]:
    valores: dict[str, Any] = {}
    for campo in campos:
        valor = getattr(opciones, campo)
        if valor is not None:
            valores[campo] = valor
    return valores


def _una(nombre: str, datos: bytes) -> list[SalidaConversion]:
    return [SalidaConversion(nombre, datos)]


def _pdf_a_pdf(ctx: _Contexto) -> list[SalidaConversion]:
    operacion = ctx.opciones.operacion
    if operacion == "unir":
        pdfs = [ctx.datos, *(datos for _, datos in ctx.adicionales)]
        return _una(f"{ctx.base}-unido.pdf", unir_pdfs(pdfs))
    if operacion == "dividir":
        return dividir_pdf(ctx.datos, ctx.opciones.rangos, nombre_base=ctx.base)
    grados = ctx.opciones.grados
    if grados is None:  # validar_opciones ya lo exigió
        raise ErrorArgumento("Falta la opción «grados».", "indicá grados con 90, 180 o 270.")
    return _una(f"{ctx.base}-rotado.pdf", rotar_pdf(ctx.datos, grados, ctx.opciones.paginas))


def _pdf_a_imagen(formato: Literal["png", "jpg"]) -> Callable[[_Contexto], list[SalidaConversion]]:
    def ejecutar(ctx: _Contexto) -> list[SalidaConversion]:
        extra = _kw(ctx.opciones, "dpi", "calidad", "paginas")
        return pdf_a_imagenes(ctx.datos, formato, nombre_base=ctx.base, **extra)

    return ejecutar


def _pdf_a_docx(ctx: _Contexto) -> list[SalidaConversion]:
    docx = pdf_a_docx(ctx.datos, ctx.config, nombre=f"{ctx.base}.pdf", titulo=ctx.base)
    return _una(f"{ctx.base}.docx", docx)


def _pdf_a_md(ctx: _Contexto) -> list[SalidaConversion]:
    texto = pdf_a_markdown(ctx.datos, ctx.config, nombre=f"{ctx.base}.pdf")
    return _una(f"{ctx.base}.md", texto.encode("utf-8"))


def _docx_a_pdf(ctx: _Contexto) -> list[SalidaConversion]:
    pdf = docx_a_pdf(ctx.datos, ctx.config, almacen=ctx.almacen, titulo=ctx.base)
    return _una(f"{ctx.base}.pdf", pdf)


def _docx_a_xlsx(ctx: _Contexto) -> list[SalidaConversion]:
    return _una(f"{ctx.base}.xlsx", docx_a_xlsx(ctx.datos, ctx.config))


def _planilla(
    origen: FormatoPlanilla, destino: PlanillaDestino
) -> Callable[[_Contexto], list[SalidaConversion]]:
    def ejecutar(ctx: _Contexto) -> list[SalidaConversion]:
        return convertir_planilla(ctx.datos, origen, destino, ctx.config, nombre_base=ctx.base)

    return ejecutar


def _imagen_a_imagen(destino: FormatoImagen) -> Callable[[_Contexto], list[SalidaConversion]]:
    def ejecutar(ctx: _Contexto) -> list[SalidaConversion]:
        extra = _kw(ctx.opciones, "calidad", "ancho_maximo")
        return _una(f"{ctx.base}.{destino}", convertir_imagen(ctx.datos, destino, **extra))

    return ejecutar


def _imagen_a_pdf(ctx: _Contexto) -> list[SalidaConversion]:
    imagenes = [ctx.datos, *(datos for _, datos in ctx.adicionales)]
    return _una(f"{ctx.base}.pdf", imagenes_a_pdf(imagenes, titulo=ctx.base))


def _audio(
    destino: FormatoAudio, *, desde_video: bool
) -> Callable[[_Contexto], list[SalidaConversion]]:
    def ejecutar(ctx: _Contexto) -> list[SalidaConversion]:
        funcion = extraer_audio if desde_video else convertir_audio
        datos = funcion(ctx.datos, destino, tiempo_limite_s=ctx.config.timeout_s)
        return _una(f"{ctx.base}.{destino}", datos)

    return ejecutar


_NOTA_PDF_DOCX = (
    "Solo conserva texto y estructura básica; pierde diseño, columnas, imágenes y tablas."
)
_NOTA_PDF_MD = "Solo texto con títulos y listas inferidos; no conserva diseño, imágenes ni tablas."
_NOTA_DOCX_PDF = "No conserva fuentes, márgenes ni imágenes flotantes."
_NOTA_DOCX_XLSX = "Solo pasa las tablas del documento (una hoja por tabla); el resto se descarta."
_ADICIONALES_IMAGEN = "archivos_adicionales"


def _construir_tabla() -> tuple[Conversion, ...]:
    tabla: list[Conversion] = []

    def agregar(
        origen: TipoOrigen,
        destino: str,
        descripcion: str,
        ejecutar: Callable[[_Contexto], list[SalidaConversion]],
        *,
        opciones: tuple[str, ...] = (),
        nota: str = "",
        ffmpeg: bool = False,
    ) -> None:
        tabla.append(
            Conversion(origen, destino, descripcion, opciones, bool(nota), ffmpeg, ejecutar, nota)
        )

    agregar(
        "pdf",
        "pdf",
        "Une, divide o rota páginas de PDF (opción operacion obligatoria).",
        _pdf_a_pdf,
        opciones=("operacion", "archivos_adicionales", "rangos", "paginas", "grados"),
    )
    agregar(
        "pdf",
        "png",
        "Una imagen PNG por página.",
        _pdf_a_imagen("png"),
        opciones=("paginas", "dpi"),
    )
    agregar(
        "pdf",
        "jpg",
        "Una imagen JPG por página.",
        _pdf_a_imagen("jpg"),
        opciones=("paginas", "dpi", "calidad"),
    )
    agregar("pdf", "docx", "Word editable con el texto.", _pdf_a_docx, nota=_NOTA_PDF_DOCX)
    agregar("pdf", "md", "Texto en Markdown.", _pdf_a_md, nota=_NOTA_PDF_MD)
    agregar("docx", "pdf", "PDF del documento.", _docx_a_pdf, nota=_NOTA_DOCX_PDF)
    agregar(
        "docx", "xlsx", "Excel con las tablas del documento.", _docx_a_xlsx, nota=_NOTA_DOCX_XLSX
    )
    descripciones: dict[str, str] = {
        "csv": "CSV (uno por hoja si hay varias).",
        "json": "JSON tabular.",
        "pdf": "PDF con la tabla.",
        "xlsx": "Excel con los datos.",
    }
    planillas: tuple[tuple[FormatoPlanilla, tuple[PlanillaDestino, ...]], ...] = (
        ("xlsx", ("csv", "json", "pdf")),
        ("csv", ("xlsx", "json", "pdf")),
        ("json", ("xlsx", "csv")),
    )
    for formato, dest_ps in planillas:
        for dest_p in dest_ps:
            agregar(formato, dest_p, descripciones[dest_p], _planilla(formato, dest_p))
    for org_i in _IMAGENES:
        otros = [f for f in _IMAGENES if f != org_i]
        for dest_i in (*otros, org_i):
            conserva = dest_i == org_i
            descripcion = (
                f"Recomprime o redimensiona el {org_i.upper()}."
                if conserva
                else f"Imagen {dest_i.upper()}."
            )
            opciones = ("ancho_maximo",) if dest_i == "png" else ("calidad", "ancho_maximo")
            agregar(org_i, dest_i, descripcion, _imagen_a_imagen(dest_i), opciones=opciones)
        agregar(
            org_i,
            "pdf",
            "PDF con una página por imagen (sumá más con archivos_adicionales).",
            _imagen_a_pdf,
            opciones=(_ADICIONALES_IMAGEN,),
        )
    for org_a in _AUDIOS:
        for dest_a in (f for f in _AUDIOS if f != org_a):
            agregar(
                org_a,
                dest_a,
                f"Audio {dest_a.upper()}.",
                _audio(dest_a, desde_video=False),
                ffmpeg=True,
            )
    for dest_v in _AUDIOS:
        agregar(
            "mp4",
            dest_v,
            f"Extrae el audio como {dest_v.upper()}.",
            _audio(dest_v, desde_video=True),
            ffmpeg=True,
        )
    return tuple(tabla)


TABLA: tuple[Conversion, ...] = _construir_tabla()


def _lista(valores: Sequence[str]) -> str:
    return ", ".join(valores)


def _no_soportado() -> ErrorFormatoNoSoportado:
    return ErrorFormatoNoSoportado(
        "No se reconoce el tipo del archivo o no se puede convertir.",
        f"subí un archivo de estos tipos: {_lista(TIPOS_ACEPTADOS)}.",
    )


# Detecta el tipo por firma binaria; la extensión solo desempata los formatos de texto sin firma.
def detectar_origen(datos: bytes, nombre: str) -> TipoOrigen:
    if not datos:
        raise ErrorArgumento("El archivo está vacío.", "subí un archivo con contenido.")
    if datos.startswith(b"%PDF-"):
        return "pdf"
    if datos.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        tipo = detectar_tipo(datos, nombre)
        if tipo == "docx":
            return "docx"
        if tipo == "xlsx":
            return "xlsx"
        raise _no_soportado()
    imagen = detectar_formato_imagen(datos)
    if imagen is not None:
        return imagen
    medio = detectar_medio(datos)
    if medio is not None:
        return medio
    tipo_texto = _EXTENSIONES_TEXTO.get(PurePath(nombre).suffix.lower())
    if tipo_texto is None:
        raise _no_soportado()
    try:
        texto = datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _no_soportado() from None
    if any(ord(c) < 32 and c not in "\t\r\n" for c in texto):
        raise _no_soportado()
    if tipo_texto == "json":
        try:
            json.loads(texto)
        except (ValueError, RecursionError):
            raise ErrorFormatoNoSoportado(
                "El archivo JSON no es válido.",
                "revisá que sea JSON bien formado, por ejemplo una lista de objetos.",
            ) from None
    return tipo_texto


# Lee del almacén con tope de tamaño antes y después de leer y valida los paquetes OOXML.
def cargar_origen(
    archivo: str, almacen: Almacen, config: Configuracion
) -> tuple[str, TipoOrigen, bytes]:
    guardado = almacen.obtener(archivo)
    verificar_tamano(guardado.tamano, config, que="el archivo")
    with guardado.ruta.open("rb") as entrada:
        datos = entrada.read(config.max_bytes + 1)
    verificar_tamano(len(datos), config, que="el archivo")
    nombre = sanear_nombre(guardado.nombre)
    tipo = detectar_origen(datos, nombre)
    if tipo in ("docx", "xlsx"):
        validar_paquete(datos, config)
    return nombre, tipo, datos


def destinos_para(origen: TipoOrigen) -> list[str]:
    return [c.destino for c in TABLA if c.origen == origen]


# Busca la conversión; si no existe, el error lista los destinos válidos para ese origen.
def buscar_conversion(origen: TipoOrigen, destino: str) -> Conversion:
    if origen == "md":
        raise ErrorFormatoNoSoportado(
            "Markdown no se convierte con esta herramienta.",
            "usá crear_pdf o crear_docx pasando el texto en el argumento markdown.",
        )
    for conversion in TABLA:
        if conversion.origen == origen and conversion.destino == destino:
            return conversion
    raise ErrorFormatoNoSoportado(
        f"No se puede convertir un archivo {origen} a «{destino}».",
        f"elegí uno de estos formatos_destino para este archivo: {_lista(destinos_para(origen))}.",
    )


def _error_opcion(
    conversion: Conversion, invalidas: list[str], aceptadas: tuple[str, ...]
) -> ErrorArgumento:
    cuales = ", ".join(f"«{o}»" for o in invalidas)
    pedida = f"{conversion.origen} a {conversion.destino}"
    cuerpo = (
        f"quitala; esta conversión acepta: {_lista(aceptadas)}."
        if aceptadas
        else "quitala; esta conversión no acepta opciones."
    )
    plural = "Las opciones" if len(invalidas) > 1 else "La opción"
    return ErrorArgumento(f"{plural} {cuales} no se aplica a la conversión {pedida}.", cuerpo)


# Rechaza las opciones que no aplican y exige las obligatorias de PDF a PDF.
def validar_opciones(conversion: Conversion, opciones: OpcionesConversion) -> None:
    presentes = _presentes(opciones)
    if conversion.origen == "pdf" and conversion.destino == "pdf":
        operacion = opciones.operacion
        if operacion is None:
            raise ErrorArgumento(
                "Falta la opción «operacion» para convertir un PDF a PDF.",
                f"indicá operacion con uno de estos valores: {_lista(_OPERACIONES_PDF)}.",
            )
        aceptadas = ("operacion", *_OPCIONES_OPERACION[operacion])
        invalidas = [o for o in presentes if o not in aceptadas]
        if invalidas:
            raise _error_opcion(conversion, invalidas, aceptadas)
        if operacion == "unir" and not opciones.archivos_adicionales:
            raise ErrorArgumento(
                "Para unir hace falta «archivos_adicionales».",
                "indicá los ids de los PDF que siguen al principal, en orden.",
            )
        if operacion == "rotar" and opciones.grados is None:
            raise ErrorArgumento(
                "Para rotar hace falta «grados».", "indicá grados con 90, 180 o 270."
            )
        return
    invalidas = [o for o in presentes if o not in conversion.opciones]
    if invalidas:
        raise _error_opcion(conversion, invalidas, conversion.opciones)


# Valida el par origen/destino y las opciones antes de cargar archivos adicionales.
def validar_conversion(
    origen: TipoOrigen, destino: str, opciones: OpcionesConversion
) -> Conversion:
    conversion = buscar_conversion(origen, destino)
    validar_opciones(conversion, opciones)
    return conversion


# Los adicionales deben ser del mismo tipo que se espera para unir o armar un PDF.
def _verificar_adicionales(
    conversion: Conversion, adicionales: Sequence[tuple[TipoOrigen, bytes]]
) -> None:
    esperado: tuple[str, ...] = ("pdf",) if conversion.origen == "pdf" else _IMAGENES
    for posicion, (tipo, _) in enumerate(adicionales, start=1):
        if tipo not in esperado:
            raise ErrorArgumento(
                f"El archivo adicional número {posicion} es {tipo}, no {_lista(esperado)}.",
                f"en archivos_adicionales indicá solo ids de archivos {_lista(esperado)}.",
            )


# Despacha según la tabla y devuelve siempre una lista de salidas con nombres ya armados.
def convertir_datos(
    nombre: str,
    origen: TipoOrigen,
    datos: bytes,
    destino: str,
    opciones: OpcionesConversion,
    *,
    adicionales: Sequence[tuple[TipoOrigen, bytes]],
    almacen: Almacen,
    config: Configuracion,
) -> list[SalidaConversion]:
    conversion = validar_conversion(origen, destino, opciones)
    _verificar_adicionales(conversion, adicionales)
    base = sanear_nombre(PurePath(nombre).stem)
    contexto = _Contexto(base, datos, opciones, adicionales, almacen, config)
    return conversion.ejecutar(contexto)
