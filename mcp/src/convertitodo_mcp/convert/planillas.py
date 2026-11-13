"""Conversión entre planillas (XLSX, CSV y JSON tabular) y de planilla a PDF."""

import csv
import json
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from io import BytesIO, StringIO
from typing import Literal, Protocol, cast

from openpyxl import load_workbook
from pydantic import ValidationError

from convertitodo_mcp.blocks import Bloque, SaltoPagina, Tabla, Titulo, Tramo
from convertitodo_mcp.blocks.planilla import Columna, Hoja, Planilla, TipoColumna, ValorSimple
from convertitodo_mcp.convert.texto_a_planilla import inferir_tipo
from convertitodo_mcp.convert.tipos import SalidaConversion
from convertitodo_mcp.errores import ErrorArgumento, ErrorLimiteExcedido
from convertitodo_mcp.limites import verificar_bloques, verificar_filas, verificar_tamano
from convertitodo_mcp.read.deteccion import validar_paquete
from convertitodo_mcp.render.pdf import MargenesPDF, OpcionesPDF, renderizar_pdf
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.render.xlsx_valores import convertir_valor
from convertitodo_mcp.server.config import Configuracion

FormatoPlanilla = Literal["xlsx", "csv", "json"]
ValorTabla = str | int | float | bool | date | datetime | None

# Tope de columnas por tabla (Excel admite 16384; más de esto no es una tabla útil).
MAX_COLUMNAS = 500
# Con más columnas que estas el PDF se arma en horizontal.
_COLUMNAS_PDF_VERTICAL = 6
_MAX_HOJAS = 255
_MUESTRA_SEPARADOR = 8192
_FECHA_MINIMA = date(1900, 3, 1)
_PREFIJOS_CSV = ("=", "+", "-", "@", "\t", "\r")
_CARACTERES_HOJA = frozenset(":\\/?*[]")
_EJEMPLO_JSON = '[{"producto": "Café", "precio": 3200}, {"producto": "Té", "precio": 1900}]'
_ESPERADO_JSON = (
    "se espera un array de objetos planos (valores de texto, número, true/false o null), "
    f"por ejemplo {_EJEMPLO_JSON}, o un objeto cuyas claves son nombres de hoja y sus valores "
    "esos arrays"
)


# Tabla leída de cualquier formato: encabezado y filas del mismo ancho (None = celda vacía).
@dataclass(frozen=True, slots=True)
class TablaLeida:
    nombre: str
    encabezado: list[str]
    filas: list[list[ValorTabla]]


class _HojaLectura(Protocol):
    title: str

    def iter_rows(self, *, values_only: bool) -> Iterator[tuple[object, ...]]: ...


class _LibroLectura(Protocol):
    worksheets: list[_HojaLectura]

    def close(self) -> None: ...


def _sin_datos() -> ErrorArgumento:
    return ErrorArgumento(
        "La planilla no contiene datos.",
        "enviá un archivo con una fila de encabezado y al menos una hoja con datos.",
    )


def _texto_valor(valor: ValorTabla) -> str:
    """Texto de una celda: fechas en ISO 8601, booleanos como TRUE/FALSE (igual que la app)."""
    if valor is None:
        return ""
    if isinstance(valor, bool):
        return "TRUE" if valor else "FALSE"
    if isinstance(valor, float):
        return str(int(valor)) if valor.is_integer() and abs(valor) < 1e15 else repr(valor)
    if isinstance(valor, date):
        return valor.isoformat()
    return str(valor)


def _normalizar_xlsx(valor: object) -> ValorTabla:
    """Reduce un valor de celda de openpyxl a un valor de tabla; vacío y '' son None."""
    if valor is None or (isinstance(valor, str) and valor == ""):
        return None
    if isinstance(valor, datetime):
        # Una fecha sin hora se guarda como medianoche: se devuelve solo la fecha.
        return valor.date() if valor.time() == time(0) else valor
    if isinstance(valor, bool | int | float | str | date):
        return valor
    if isinstance(valor, time):
        return valor.isoformat()
    if isinstance(valor, timedelta):
        return str(valor)
    return str(valor)


def _recortar(fila: list[ValorTabla]) -> list[ValorTabla]:
    while fila and fila[-1] is None:
        fila.pop()
    return fila


def _armar_tabla(nombre: str, filas: list[list[ValorTabla]]) -> TablaLeida:
    """Usa la primera fila como encabezado y completa las demás al mismo ancho."""
    ancho = max(len(fila) for fila in filas)
    if ancho > MAX_COLUMNAS:
        raise ErrorLimiteExcedido(
            f"Una tabla tiene {ancho} columnas y el máximo permitido es {MAX_COLUMNAS}.",
            "dejá solo las columnas necesarias y reintentá.",
        )
    completas: list[list[ValorTabla]] = [fila + [None] * (ancho - len(fila)) for fila in filas]
    encabezado = [_texto_valor(valor) for valor in completas[0]]
    return TablaLeida(nombre=nombre, encabezado=encabezado, filas=completas[1:])


def _leer_xlsx(datos: bytes, config: Configuracion) -> list[TablaLeida]:
    # Se leen los valores guardados (data_only): una fórmula sin valor cacheado queda vacía.
    validar_paquete(datos, config)
    try:
        libro = cast(
            "_LibroLectura",
            load_workbook(BytesIO(datos), read_only=True, data_only=True, keep_links=False),
        )
    except Exception:
        raise ErrorArgumento(
            "No se pudo abrir la planilla XLSX.", "exportala de nuevo desde su aplicación."
        ) from None
    tablas: list[TablaLeida] = []
    total = 0
    try:
        for hoja in libro.worksheets:
            filas: list[list[ValorTabla]] = []
            # Las filas vacías solo cuentan si después aparece una con datos.
            pendientes = 0
            for fila in hoja.iter_rows(values_only=True):
                if len(fila) > MAX_COLUMNAS * 4:
                    fila = fila[: MAX_COLUMNAS * 4]
                valores = _recortar([_normalizar_xlsx(valor) for valor in fila])
                if not valores:
                    pendientes += 1 if filas else 0
                    continue
                for _ in range(pendientes):
                    filas.append([])
                pendientes = 0
                filas.append(valores)
                if len(filas) > 1:
                    verificar_filas(total + len(filas) - 1, config)
            if filas:
                tablas.append(_armar_tabla(hoja.title, filas))
                total += len(filas) - 1
    except (ErrorArgumento, ErrorLimiteExcedido):
        raise
    except Exception:
        raise ErrorArgumento(
            "No se pudo leer el contenido de la planilla XLSX.",
            "verificá que el archivo no esté dañado y exportalo de nuevo.",
        ) from None
    finally:
        libro.close()
    if not tablas:
        raise _sin_datos()
    return tablas


def _decodificar_csv(datos: bytes) -> str:
    # UTF-8 con o sin BOM; si no es UTF-8 válido se asume una codificación Windows (Excel).
    try:
        return datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return datos.decode("cp1252")
        except UnicodeDecodeError:
            return datos.decode("latin-1")


def _separador(texto: str) -> str:
    try:
        return csv.Sniffer().sniff(texto[:_MUESTRA_SEPARADOR], delimiters=",;\t").delimiter
    except csv.Error:
        return ","


def _leer_csv(datos: bytes, config: Configuracion) -> list[TablaLeida]:
    texto = _decodificar_csv(datos)
    filas: list[list[str]] = []
    try:
        for fila in csv.reader(StringIO(texto, newline=""), delimiter=_separador(texto)):
            if any(fila):
                filas.append(fila)
                verificar_filas(len(filas) - 1, config)
    except csv.Error:
        raise ErrorArgumento(
            "El CSV tiene un campo demasiado largo o un formato inválido.",
            "reexportalo como UTF-8 con comillas dobles en los campos con separadores.",
        ) from None
    if not filas:
        raise ErrorArgumento("El CSV está vacío.", "enviá un CSV con una fila de encabezado.")
    ancho = len(filas[0])
    if ancho > MAX_COLUMNAS:
        raise ErrorLimiteExcedido(
            f"El CSV tiene {ancho} columnas y el máximo permitido es {MAX_COLUMNAS}.",
            "dejá solo las columnas necesarias y reintentá.",
        )
    for numero, fila in enumerate(filas[1:], start=1):
        if len(fila) > ancho:
            raise ErrorArgumento(
                f"La fila {numero} del CSV tiene {len(fila)} valores y el encabezado {ancho}.",
                "agregá columnas al encabezado o quitá los valores sobrantes de la fila.",
            )
    cuerpo: list[list[ValorTabla]] = []
    for fila in filas[1:]:
        celdas: list[ValorTabla] = [valor or None for valor in fila]
        cuerpo.append(celdas + [None] * (ancho - len(fila)))
    return [TablaLeida(nombre="Hoja1", encabezado=list(filas[0]), filas=cuerpo)]


def _no_tabular(detalle: str) -> ErrorArgumento:
    return ErrorArgumento(
        f"El JSON no es tabular: {detalle}", f"usá un JSON donde {_ESPERADO_JSON}."
    )


def _tabla_json(
    nombre: str, registros: object, acumulado: int, config: Configuracion
) -> TablaLeida:
    if not isinstance(registros, list) or not registros:
        raise _no_tabular("se necesita un array con al menos un objeto.")
    verificar_filas(acumulado + len(registros), config)
    columnas: dict[str, None] = {}
    for numero, registro in enumerate(registros, start=1):
        if not isinstance(registro, dict):
            raise _no_tabular(f"el elemento {numero} del array no es un objeto.")
        for valor in registro.values():
            if isinstance(valor, dict | list):
                raise _no_tabular(f"el registro {numero} contiene un objeto o lista anidado.")
        columnas.update(dict.fromkeys(registro))
        if len(columnas) > MAX_COLUMNAS:
            raise ErrorLimiteExcedido(
                f"El JSON tiene más de {MAX_COLUMNAS} columnas distintas.",
                "dejá solo los campos necesarios y reintentá.",
            )
    filas: list[list[ValorTabla]] = [
        [cast("ValorTabla", registro.get(clave)) for clave in columnas] for registro in registros
    ]
    return TablaLeida(nombre=nombre, encabezado=list(columnas), filas=filas)


def _rechazar_constante(_: str) -> object:
    raise ValueError


def _leer_json(datos: bytes, config: Configuracion) -> list[TablaLeida]:
    try:
        contenido = json.loads(datos.decode("utf-8-sig"), parse_constant=_rechazar_constante)
    except (ValueError, RecursionError):
        raise ErrorArgumento(
            "El archivo no es un JSON válido.",
            "revisá la sintaxis (sin NaN ni Infinity) y que esté codificado en UTF-8.",
        ) from None
    if isinstance(contenido, list):
        return [_tabla_json("Hoja1", contenido, 0, config)]
    if isinstance(contenido, dict) and contenido:
        if len(contenido) > _MAX_HOJAS:
            raise ErrorLimiteExcedido(
                f"El JSON define {len(contenido)} hojas y el máximo es {_MAX_HOJAS}.",
                "dejá menos claves en el objeto principal.",
            )
        tablas: list[TablaLeida] = []
        total = 0
        for nombre, registros in contenido.items():
            tabla = _tabla_json(nombre, registros, total, config)
            total += len(tabla.filas)
            tablas.append(tabla)
        return tablas
    raise _no_tabular("el contenido es un valor suelto o un objeto vacío.")


def leer_tablas(datos: bytes, formato: FormatoPlanilla, config: Configuracion) -> list[TablaLeida]:
    """Lee las tablas del archivo; XLSX da una por hoja con datos, CSV y JSON una o más."""
    verificar_tamano(len(datos), config, que="la planilla")
    if formato == "xlsx":
        return _leer_xlsx(datos, config)
    if formato == "csv":
        return _leer_csv(datos, config)
    if formato == "json":
        return _leer_json(datos, config)
    raise ErrorArgumento(
        f"El formato de planilla '{formato}' no es válido.", "usá xlsx, csv o json."
    )


def _encabezados_unicos(encabezado: Sequence[str]) -> list[str]:
    """Nombres no vacíos y sin repetir (sin distinguir mayúsculas): columna_3, nombre_2."""
    resultado: list[str] = []
    vistos: set[str] = set()
    for indice, original in enumerate(encabezado, start=1):
        base = original.strip()[:250] or f"columna_{indice}"
        candidato = base
        sufijo = 2
        while candidato.lower() in vistos:
            candidato = f"{base}_{sufijo}"
            sufijo += 1
        vistos.add(candidato.lower())
        resultado.append(candidato)
    return resultado


def _nombre_hoja(nombre: str, usados: set[str], numero: int) -> str:
    """Nombre válido para Excel (31 caracteres, sin caracteres prohibidos) y único."""
    base = "".join("_" if c in _CARACTERES_HOJA or ord(c) < 32 else c for c in nombre)
    base = base.strip().strip("'").strip()[:31] or f"Hoja{numero}"
    if base.lower() == "history":
        base = "Hoja_history"
    candidato = base
    sufijo = 2
    while candidato.lower() in usados:
        extra = f" ({sufijo})"
        candidato = base[: 31 - len(extra)] + extra
        sufijo += 1
    usados.add(candidato.lower())
    return candidato


def _a_simple(valor: ValorTabla) -> ValorSimple:
    return valor.isoformat() if isinstance(valor, date) else valor


def _columna(nombre: str, valores: list[ValorTabla]) -> tuple[Columna, list[ValorSimple]]:
    """Elige tipo y formato de la columna; los números nunca quedan como texto."""
    presentes = [valor for valor in valores if valor is not None]
    simples = [_a_simple(valor) for valor in valores]
    tipo: TipoColumna = "texto"
    formato: str | None = None
    if presentes and all(isinstance(v, str) for v in presentes):
        tipo = inferir_tipo([cast("str", v) for v in presentes])
    elif presentes and all(
        isinstance(v, int | float) and not isinstance(v, bool) for v in presentes
    ):
        tipo = "entero" if all(isinstance(v, int) for v in presentes) else "numero"
    elif (
        presentes
        and all(isinstance(v, date) for v in presentes)
        and all(
            (v.date() if isinstance(v, datetime) else cast("date", v)) >= _FECHA_MINIMA
            for v in presentes
        )
    ):
        tipo = "fecha"
    # Sin separador de miles: un año o un código numérico no debe verse como 2,024.
    if tipo == "entero":
        formato = "0"
    elif tipo == "numero":
        formato = "General"
    return Columna(nombre=nombre, tipo=tipo, formato=formato), simples


def _hoja(tabla: TablaLeida, nombre: str) -> Hoja:
    nombres = _encabezados_unicos(tabla.encabezado)
    columnas: list[Columna] = []
    por_columna: list[list[ValorSimple]] = []
    for indice, titulo in enumerate(nombres):
        columna, valores = _columna(titulo, [fila[indice] for fila in tabla.filas])
        columnas.append(columna)
        por_columna.append(valores)
    filas = [list(fila) for fila in zip(*por_columna, strict=True)] if tabla.filas else []
    try:
        return Hoja(nombre=nombre, columnas=columnas, filas=filas)
    except ValidationError:
        raise ErrorArgumento(
            "No se pudo armar una hoja de la planilla.",
            "revisá los nombres de columna y de hoja de la entrada.",
        ) from None


def tablas_a_xlsx(tablas: Sequence[TablaLeida], config: Configuracion) -> bytes:
    """Una hoja por tabla; el texto numérico o de fecha se guarda con su tipo real."""
    if not tablas:
        raise _sin_datos()
    if len(tablas) > _MAX_HOJAS:
        raise ErrorLimiteExcedido(
            f"Hay {len(tablas)} tablas y un libro admite {_MAX_HOJAS} hojas.",
            "convertí menos hojas por vez.",
        )
    usados: set[str] = set()
    hojas = [
        _hoja(tabla, _nombre_hoja(tabla.nombre, usados, numero))
        for numero, tabla in enumerate(tablas, start=1)
    ]
    return renderizar_xlsx(Planilla(hojas=hojas), config)


def _neutralizar_csv(valor: ValorTabla) -> str:
    """Antepone ' al texto que una planilla podría evaluar como fórmula; no toca números."""
    texto = _texto_valor(valor)
    if isinstance(valor, str) and texto.startswith(_PREFIJOS_CSV):
        return "'" + texto
    return texto


def _nombre_archivo(texto: str, respaldo: str) -> str:
    limpio = re.sub(r"[^\w.-]+", "_", texto, flags=re.UNICODE).strip("._-")[:60]
    return limpio or respaldo


def tablas_a_csv(
    tablas: Sequence[TablaLeida], *, nombre_base: str = "planilla"
) -> list[SalidaConversion]:
    """Un CSV UTF-8 (sin BOM, separador coma, saltos \\n) por tabla, como hace la app."""
    if not tablas:
        raise _sin_datos()
    base = _nombre_archivo(nombre_base, "planilla")
    usados: set[str] = set()
    salidas: list[SalidaConversion] = []
    for numero, tabla in enumerate(tablas, start=1):
        if len(tablas) == 1:
            nombre = f"{base}.csv"
        else:
            hoja = _nombre_archivo(tabla.nombre, f"hoja{numero}")
            nombre = f"{base}-{hoja}.csv"
            sufijo = 2
            while nombre.lower() in usados:
                nombre = f"{base}-{hoja}-{sufijo}.csv"
                sufijo += 1
        usados.add(nombre.lower())
        salida = StringIO(newline="")
        escritor = csv.writer(salida, lineterminator="\n")
        escritor.writerow([_neutralizar_csv(titulo) for titulo in tabla.encabezado])
        for fila in tabla.filas:
            escritor.writerow([_neutralizar_csv(valor) for valor in fila])
        salidas.append(SalidaConversion(nombre=nombre, datos=salida.getvalue().encode("utf-8")))
    return salidas


def _valores_json(valores: list[ValorTabla]) -> list[ValorTabla]:
    """Convierte a número el texto numérico de una columna (el CSV llega siempre como texto)."""
    textos = [valor for valor in valores if isinstance(valor, str)]
    if not textos or len(textos) != sum(valor is not None for valor in valores):
        return valores
    if inferir_tipo(textos) not in ("entero", "numero"):
        return valores
    tipo: TipoColumna = (
        "entero"
        if all(isinstance(convertir_valor(v, "numero", "la celda"), int) for v in textos)
        else "numero"
    )
    return [convertir_valor(v, tipo, "la celda") if isinstance(v, str) else v for v in valores]


def _valor_json(valor: ValorTabla) -> str | int | float | bool | None:
    return valor.isoformat() if isinstance(valor, date) else valor


def _registros(tabla: TablaLeida) -> list[dict[str, str | int | float | bool | None]]:
    nombres = _encabezados_unicos(tabla.encabezado)
    columnas = [
        _valores_json([fila[indice] for fila in tabla.filas]) for indice in range(len(nombres))
    ]
    return [
        {
            nombre: _valor_json(columna[numero])
            for nombre, columna in zip(nombres, columnas, strict=True)
        }
        for numero in range(len(tabla.filas))
    ]


def tablas_a_json(tablas: Sequence[TablaLeida]) -> bytes:
    """Una tabla da un array de objetos; varias, un objeto por hoja. Fechas en ISO 8601."""
    if not tablas:
        raise _sin_datos()
    contenido: object
    if len(tablas) == 1:
        contenido = _registros(tablas[0])
    else:
        hojas: dict[str, object] = {}
        for tabla in tablas:
            nombre = tabla.nombre
            sufijo = 2
            while nombre in hojas:
                nombre = f"{tabla.nombre}_{sufijo}"
                sufijo += 1
            hojas[nombre] = _registros(tabla)
        contenido = hojas
    return json.dumps(contenido, ensure_ascii=False, indent=2).encode("utf-8")


def tablas_a_pdf(tablas: Sequence[TablaLeida], config: Configuracion, *, titulo: str = "") -> bytes:
    """Tabla con encabezado repetido por página; una sección por hoja, horizontal si es ancha."""
    if not tablas:
        raise _sin_datos()
    bloques: list[Bloque] = []
    for numero, tabla in enumerate(tablas):
        if numero > 0:
            bloques.append(SaltoPagina())
        if len(tablas) > 1:
            bloques.append(
                Titulo(nivel=1, texto=[Tramo(texto=tabla.nombre or f"Hoja{numero + 1}")])
            )
        bloques.append(
            Tabla(
                encabezado=[[Tramo(texto=texto)] for texto in tabla.encabezado],
                filas=[
                    [[Tramo(texto=_texto_valor(valor))] for valor in fila] for fila in tabla.filas
                ],
            )
        )
    verificar_bloques(bloques, config)
    ancho = max(len(tabla.encabezado) for tabla in tablas)
    opciones = OpcionesPDF(
        orientacion="horizontal" if ancho > _COLUMNAS_PDF_VERTICAL else "vertical",
        margenes=MargenesPDF(superior=15, inferior=15, izquierdo=15, derecho=15),
        titulo=titulo,
    )
    return renderizar_pdf(bloques, opciones)


def convertir_planilla(
    datos: bytes,
    origen: FormatoPlanilla,
    destino: Literal["xlsx", "csv", "json", "pdf"],
    config: Configuracion,
    *,
    nombre_base: str = "planilla",
) -> list[SalidaConversion]:
    """Convierte entre XLSX, CSV y JSON, o a PDF; devuelve uno o más archivos."""
    if origen == destino:
        raise ErrorArgumento(
            f"El origen y el destino son ambos '{origen}'.",
            "elegí un formato de destino distinto del de origen.",
        )
    if destino not in ("xlsx", "csv", "json", "pdf"):
        raise ErrorArgumento(
            f"El formato de destino '{destino}' no es válido.", "usá xlsx, csv, json o pdf."
        )
    tablas = leer_tablas(datos, origen, config)
    base = _nombre_archivo(nombre_base, "planilla")
    if destino == "csv":
        return tablas_a_csv(tablas, nombre_base=base)
    if destino == "xlsx":
        return [SalidaConversion(f"{base}.xlsx", tablas_a_xlsx(tablas, config))]
    if destino == "json":
        return [SalidaConversion(f"{base}.json", tablas_a_json(tablas))]
    return [SalidaConversion(f"{base}.pdf", tablas_a_pdf(tablas, config, titulo=base))]
