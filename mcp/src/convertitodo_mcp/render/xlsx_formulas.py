"""Validación básica de fórmulas de Excel: sintaxis, funciones y referencias."""

import re
from collections.abc import Collection

from openpyxl.formula.tokenizer import Token, Tokenizer
from openpyxl.utils import FORMULAE, column_index_from_string

from convertitodo_mcp.blocks.planilla import MAX_COLUMNAS_EXCEL, MAX_FILAS_EXCEL
from convertitodo_mcp.errores import ErrorArgumento

# Funciones que consultan el entorno, abren enlaces o leen referencias que no se pueden validar.
FUNCIONES_BLOQUEADAS = frozenset({"CELL", "HYPERLINK", "INDIRECT", "INFO", "RTD"})

# Nombres en español frecuentes, para sugerir el equivalente que entiende el archivo.
_EN_ESPANOL = {
    "SUMA": "SUM",
    "PROMEDIO": "AVERAGE",
    "SI": "IF",
    "CONTAR": "COUNT",
    "CONTARA": "COUNTA",
    "CONTAR.SI": "COUNTIF",
    "SUMAR.SI": "SUMIF",
    "BUSCARV": "VLOOKUP",
    "REDONDEAR": "ROUND",
    "HOY": "TODAY",
    "CONCATENAR": "CONCATENATE",
    "SI.ERROR": "IFERROR",
    "Y": "AND",
    "O": "OR",
}

_COLUMNA = r"\$?([A-Za-z]{1,3})"
_FILA = r"\$?(\d{1,7})"
_CELDA = re.compile(rf"{_COLUMNA}{_FILA}")
_RANGO_COLUMNAS = re.compile(rf"{_COLUMNA}:{_COLUMNA}")
_RANGO_FILAS = re.compile(rf"{_FILA}:{_FILA}")


def _error(ubicacion: str, que_fallo: str, como: str) -> ErrorArgumento:
    return ErrorArgumento(f"La fórmula de {ubicacion} no es válida: {que_fallo}", como)


def _columna_valida(letras: str) -> bool:
    indice: int = column_index_from_string(letras.upper())
    return indice <= MAX_COLUMNAS_EXCEL


def _fila_valida(numero: str) -> bool:
    return 1 <= int(numero) <= MAX_FILAS_EXCEL


def _direccion_valida(direccion: str) -> bool:
    partes = direccion.split(":")
    if len(partes) == 2 and (coincidencia := _RANGO_COLUMNAS.fullmatch(direccion)):
        return all(_columna_valida(letras) for letras in coincidencia.groups())
    if len(partes) == 2 and (coincidencia := _RANGO_FILAS.fullmatch(direccion)):
        return all(_fila_valida(numero) for numero in coincidencia.groups())
    if len(partes) > 2:
        return False
    for parte in partes:
        celda = _CELDA.fullmatch(parte)
        if celda is None or not _columna_valida(celda[1]) or not _fila_valida(celda[2]):
            return False
    return True


def _hoja_de_referencia(prefijo: str) -> str:
    if prefijo.startswith("'") and prefijo.endswith("'") and len(prefijo) >= 2:
        return prefijo[1:-1].replace("''", "'")
    return prefijo


def _validar_referencia(
    token: Token, hojas: Collection[str], tablas: Collection[str], ubicacion: str
) -> None:
    valor = token.value
    tabla, corchete, _ = valor.partition("[")
    if corchete and tabla and "!" not in valor:
        # Referencia estructurada a una tabla de esta planilla, por ejemplo Ventas[Precio].
        if tabla.lower() not in {nombre.lower() for nombre in tablas}:
            raise _error(
                ubicacion,
                f"la tabla '{tabla}' no existe en la planilla.",
                "usá el nombre de una tabla definida con el campo 'tabla' de una hoja.",
            )
        return
    if valor.startswith("[") or "]!" in valor or "[" in valor.split("!")[0]:
        raise _error(
            ubicacion,
            f"'{valor}' apunta a otro libro.",
            "usá solo referencias a hojas de esta planilla.",
        )
    prefijo, separador, direccion = valor.rpartition("!")
    if separador:
        hoja = _hoja_de_referencia(prefijo)
        if hoja.lower() not in {nombre.lower() for nombre in hojas}:
            raise _error(
                ubicacion,
                f"la hoja '{hoja}' no existe en la planilla.",
                "usá el nombre exacto de una hoja existente, entre apóstrofos si tiene espacios.",
            )
    if not _direccion_valida(direccion):
        raise _error(
            ubicacion,
            f"'{valor}' no es una celda ni un rango válido.",
            "usá referencias como A1, $B$2, A1:C10, A:A o 'Hoja 2'!B3, dentro de los límites "
            "de Excel.",
        )


def _validar_funcion(token: Token, ubicacion: str) -> None:
    nombre = token.value.removesuffix("(").upper().removeprefix("_XLFN.")
    if nombre in FUNCIONES_BLOQUEADAS:
        raise _error(
            ubicacion,
            f"la función {nombre} no está permitida.",
            "calculá el valor con funciones que no consulten el entorno ni abran enlaces.",
        )
    if nombre not in FORMULAE:
        sugerencia = _EN_ESPANOL.get(nombre)
        como = (
            f"usá {sugerencia} en lugar de {nombre}: las fórmulas se escriben en inglés."
            if sugerencia
            else "usá una función estándar de Excel con su nombre en inglés."
        )
        raise _error(ubicacion, f"la función {nombre} no se reconoce.", como)


def validar_formula(
    formula: str, hojas: Collection[str], ubicacion: str, tablas: Collection[str] = ()
) -> str:
    """Devuelve la fórmula normalizada con '=' inicial o lanza ErrorArgumento."""
    texto = formula.strip()
    if not texto.startswith("="):
        texto = "=" + texto
    if len(texto) < 2 or any(ord(c) < 32 for c in texto):
        raise _error(
            ubicacion, "está vacía o tiene saltos de línea.", "escribila en una sola línea."
        )
    try:
        tokens = Tokenizer(texto).items
    except Exception:
        raise _error(
            ubicacion,
            "la sintaxis es incorrecta (comillas o corchetes sin cerrar).",
            "revisá comillas, paréntesis y separadores; los argumentos se separan con coma.",
        ) from None
    profundidad = 0
    for token in tokens:
        if token.subtype == Token.OPEN:
            profundidad += 1
        elif token.subtype == Token.CLOSE:
            profundidad -= 1
        if profundidad < 0:
            break
        if token.type == Token.FUNC and token.subtype == Token.OPEN:
            _validar_funcion(token, ubicacion)
        elif token.type == Token.OPERAND and token.subtype == Token.RANGE:
            _validar_referencia(token, hojas, tablas, ubicacion)
        elif (
            token.type == Token.OPERAND
            and token.subtype == Token.ERROR
            and token.value.upper() != "#N/A"
        ):
            raise _error(
                ubicacion,
                f"contiene el error {token.value}.",
                "reemplazá el error por una referencia o un valor válido.",
            )
    if profundidad != 0:
        raise _error(
            ubicacion,
            "los paréntesis no están balanceados.",
            "cerrá cada paréntesis abierto y quitá los que sobran.",
        )
    return texto
