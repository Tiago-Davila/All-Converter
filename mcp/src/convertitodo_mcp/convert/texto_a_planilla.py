"""Entrada rápida: una tabla Markdown o un CSV se convierte en una hoja con tipos inferidos."""

import csv
import re
from io import StringIO

from pydantic import ValidationError

from convertitodo_mcp.blocks import Tabla, markdown_a_bloques, texto_plano
from convertitodo_mcp.blocks.planilla import Columna, Hoja, TipoColumna
from convertitodo_mcp.errores import ErrorArgumento
from convertitodo_mcp.render.xlsx_valores import convertir_valor

# Ceros a la izquierda, dígitos separados por espacios (teléfonos) o más de 15 dígitos
# (identificadores) indican un código: se conserva como texto para no perder información.
_CERO_INICIAL = re.compile(r"[+-]?0\d")
_DIGITOS_SEPARADOS = re.compile(r"\d\s+\d")
_MAX_DIGITOS = 15


def _es_codigo(valor: str) -> bool:
    limpio = valor.strip()
    return bool(
        _CERO_INICIAL.match(limpio)
        or _DIGITOS_SEPARADOS.search(limpio)
        or sum(c.isdigit() for c in limpio) > _MAX_DIGITOS
    )


def _admite(valores: list[str], tipo: TipoColumna) -> bool:
    try:
        for valor in valores:
            convertir_valor(valor, tipo, "la celda")
    except ErrorArgumento:
        return False
    return True


def inferir_tipo(valores: list[str]) -> TipoColumna:
    """Elige el tipo más específico que admiten todos los valores no vacíos."""
    presentes = [valor for valor in valores if valor.strip()]
    if not presentes:
        return "texto"
    if all(valor.strip().endswith("%") for valor in presentes):
        return "porcentaje" if _admite(presentes, "porcentaje") else "texto"
    if _admite(presentes, "fecha"):
        return "fecha"
    if any(_es_codigo(valor) for valor in presentes):
        return "texto"
    if all(any(s in valor for s in "$€£") for valor in presentes) and _admite(presentes, "moneda"):
        return "moneda"
    for tipo in ("entero", "numero"):
        if _admite(presentes, tipo):
            return tipo
    return "texto"


def _encabezados(nombres: list[str]) -> list[str]:
    resultado: list[str] = []
    vistos: set[str] = set()
    for indice, nombre in enumerate(nombres, start=1):
        base = (nombre.strip() or f"Columna {indice}")[:250]
        candidato = base
        sufijo = 2
        while candidato.lower() in vistos:
            candidato = f"{base} ({sufijo})"
            sufijo += 1
        vistos.add(candidato.lower())
        resultado.append(candidato)
    return resultado


def hoja_desde_tabla(nombre: str, encabezado: list[str], filas: list[list[str]]) -> Hoja:
    """Arma una hoja con un tipo inferido por columna; las celdas vacías quedan en null."""
    columnas = len(encabezado)
    tipos = [inferir_tipo([fila[indice] for fila in filas]) for indice in range(columnas)]
    try:
        return Hoja(
            nombre=nombre,
            columnas=[
                Columna(nombre=titulo, tipo=tipo)
                for titulo, tipo in zip(_encabezados(encabezado), tipos, strict=True)
            ],
            filas=[
                [
                    valor if valor.strip() or tipo == "texto" else None
                    for valor, tipo in zip(fila, tipos, strict=True)
                ]
                for fila in filas
            ],
        )
    except ValidationError as exc:
        raise ErrorArgumento(
            f"No se pudo armar la hoja '{nombre}': {exc.errors()[0]['msg']}",
            "revisá el nombre de la hoja y la tabla de entrada.",
        ) from None


def hoja_desde_markdown(markdown: str, nombre: str = "Hoja1") -> Hoja:
    """Convierte la única tabla de un texto Markdown en una hoja."""
    tablas = [bloque for bloque in markdown_a_bloques(markdown) if isinstance(bloque, Tabla)]
    if len(tablas) != 1:
        raise ErrorArgumento(
            f"El Markdown tiene {len(tablas)} tablas y se necesita exactamente una.",
            "enviá una sola tabla Markdown con encabezado, o usá 'hojas' para varias.",
        )
    tabla = tablas[0]
    filas = [[texto_plano(celda) for celda in fila] for fila in tabla.filas]
    if tabla.encabezado is not None:
        encabezado = [texto_plano(celda) for celda in tabla.encabezado]
    else:
        encabezado = [""] * (len(filas[0]) if filas else 0)
    if not encabezado:
        raise ErrorArgumento("La tabla Markdown está vacía.", "agregá encabezado y filas.")
    return hoja_desde_tabla(nombre, encabezado, filas)


def hoja_desde_csv(texto: str, nombre: str = "Hoja1") -> Hoja:
    """Convierte un CSV con encabezado en una hoja; detecta coma, punto y coma o tabulación."""
    texto = texto.removeprefix("\ufeff")
    # El encabezado no suele tener decimales: el delimitador es el que más campos le da.
    primera = next((linea for linea in texto.splitlines() if linea.strip()), "")
    delimitador = max(
        ",;\t", key=lambda candidato: len(next(csv.reader([primera], delimiter=candidato), []))
    )
    filas = [
        fila for fila in csv.reader(StringIO(texto, newline=""), delimiter=delimitador) if any(fila)
    ]
    if not filas:
        raise ErrorArgumento("El CSV está vacío.", "enviá un CSV con una fila de encabezado.")
    encabezado, datos = filas[0], filas[1:]
    for numero, fila in enumerate(datos, start=1):
        if len(fila) > len(encabezado):
            raise ErrorArgumento(
                f"La fila {numero} del CSV tiene {len(fila)} valores y el encabezado "
                f"{len(encabezado)}.",
                "agregá columnas al encabezado o quitá valores sobrantes de la fila.",
            )
    # Las filas cortas se completan con celdas vacías.
    completas = [fila + [""] * (len(encabezado) - len(fila)) for fila in datos]
    return hoja_desde_tabla(nombre, encabezado, completas)
