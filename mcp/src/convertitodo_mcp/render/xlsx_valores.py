"""Conversión de valores enviados por el modelo a tipos reales de celda de Excel."""

import math
import re
from datetime import date, datetime

from convertitodo_mcp.blocks.planilla import TipoColumna, ValorSimple
from convertitodo_mcp.errores import ErrorArgumento

ValorCelda = bool | int | float | str | date | datetime | None

FORMATOS: dict[TipoColumna, str] = {
    "texto": "General",
    "numero": "#,##0.00",
    "entero": "#,##0",
    "moneda": '"$" #,##0.00',
    "porcentaje": "0.00%",
    "fecha": "dd/mm/yyyy",
}
FORMATO_FECHA_HORA = "dd/mm/yyyy hh:mm"

_SIMBOLOS_MONEDA = "$€£"
_NUMERO = re.compile(r"[+-]?\d+(\.\d+)?([eE][+-]?\d+)?")
_FECHA_REGIONAL = re.compile(
    r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?"
)
# Excel no representa fechas anteriores a 1900 en el sistema de fechas por defecto.
_FECHA_MINIMA = date(1900, 3, 1)


# Interpreta un número escrito como texto con coma o punto decimal y separador de miles.
def _texto_a_numero(texto: str) -> int | float | None:
    limpio = texto.strip().strip(_SIMBOLOS_MONEDA).strip()
    limpio = limpio.replace(" ", "").replace("\u00a0", "")
    if "," in limpio and "." in limpio:
        # El separador que aparece último es el decimal.
        decimal = "," if limpio.rfind(",") > limpio.rfind(".") else "."
        miles = "." if decimal == "," else ","
        limpio = limpio.replace(miles, "").replace(decimal, ".")
    elif limpio.count(",") == 1:
        limpio = limpio.replace(",", ".")
    elif limpio.count(",") > 1 or limpio.count(".") > 1:
        limpio = limpio.replace(",", "").replace(".", "")
    if not _NUMERO.fullmatch(limpio):
        return None
    if "." in limpio or "e" in limpio.lower():
        return float(limpio)
    return int(limpio)


def _numero(valor: ValorSimple) -> int | float | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int | float):
        resultado: int | float | None = valor
    elif isinstance(valor, str):
        resultado = _texto_a_numero(valor)
    else:
        return None
    if isinstance(resultado, float) and not math.isfinite(resultado):
        return None
    return resultado


def _fecha(valor: ValorSimple) -> date | datetime | None:
    if not isinstance(valor, str):
        return None
    texto = valor.strip()
    resultado: date | datetime
    try:
        resultado = datetime.fromisoformat(texto) if len(texto) > 10 else date.fromisoformat(texto)
    except ValueError:
        coincidencia = _FECHA_REGIONAL.fullmatch(texto)
        if coincidencia is None:
            return None
        dia, mes, anio, hora, minuto, segundo = coincidencia.groups()
        try:
            if hora is None:
                resultado = date(int(anio), int(mes), int(dia))
            else:
                resultado = datetime(
                    int(anio), int(mes), int(dia), int(hora), int(minuto), int(segundo or 0)
                )
        except ValueError:
            return None
    if isinstance(resultado, datetime) and resultado.tzinfo is not None:
        return None
    fecha = resultado.date() if isinstance(resultado, datetime) else resultado
    return resultado if fecha >= _FECHA_MINIMA else None


_ESPERADO: dict[TipoColumna, str] = {
    "texto": "texto o número",
    "numero": "un número (por ejemplo 1234.5 o '1.234,5')",
    "entero": "un número entero",
    "moneda": "un importe numérico (por ejemplo 1500.25 o '$ 1.500,25')",
    "porcentaje": "una fracción (0.15) o un texto con % ('15 %')",
    "fecha": "una fecha AAAA-MM-DD o DD/MM/AAAA posterior a 1900, sin zona horaria",
}


def convertir_valor(valor: ValorSimple, tipo: TipoColumna, ubicacion: str) -> ValorCelda:
    """Devuelve el valor con su tipo real; un número nunca queda guardado como texto."""
    if valor is None or (isinstance(valor, str) and not valor.strip() and tipo != "texto"):
        return None
    resultado: ValorCelda
    if tipo == "texto":
        # Los números JSON se conservan como número aunque la columna sea de texto.
        resultado = valor
        if isinstance(valor, float) and not math.isfinite(valor):
            resultado = None
    elif tipo == "fecha":
        resultado = _fecha(valor)
    elif tipo == "porcentaje" and isinstance(valor, str) and valor.strip().endswith("%"):
        numero = _numero(valor.strip().removesuffix("%"))
        resultado = None if numero is None else numero / 100
    else:
        resultado = _numero(valor)
        if tipo == "entero" and resultado is not None:
            resultado = int(resultado) if float(resultado).is_integer() else None
    if resultado is None:
        raise ErrorArgumento(
            f"El valor {valor!r} de {ubicacion} no es válido para una columna de tipo {tipo}.",
            f"enviá {_ESPERADO[tipo]}, null para dejar la celda vacía, o cambiá el tipo de "
            "la columna.",
        )
    return resultado


def formato_para(tipo: TipoColumna, valor: ValorCelda, formato: str | None) -> str:
    """Formato numérico de la celda: el de la columna o el predeterminado de su tipo."""
    if formato is not None:
        return formato
    if isinstance(valor, datetime):
        return FORMATO_FECHA_HORA
    return FORMATOS[tipo]
