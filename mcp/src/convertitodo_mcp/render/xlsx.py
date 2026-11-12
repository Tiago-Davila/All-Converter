"""Renderizado de una planilla tipada a XLSX con openpyxl."""

from collections.abc import Collection
from io import BytesIO

from openpyxl import Workbook
from openpyxl.cell.cell import Cell
from openpyxl.worksheet.worksheet import Worksheet

from convertitodo_mcp.blocks.planilla import Formula, Hoja, Planilla, TipoColumna, Valor
from convertitodo_mcp.limites import verificar_filas
from convertitodo_mcp.render.xlsx_formulas import validar_formula
from convertitodo_mcp.render.xlsx_valores import FORMATOS, convertir_valor, formato_para
from convertitodo_mcp.server.config import Configuracion


def escribir_celda(
    celda: Cell,
    valor: Valor,
    tipo: TipoColumna,
    formato: str | None,
    *,
    hojas: Collection[str],
    ubicacion: str,
) -> None:
    """Escribe un literal tipado o una fórmula validada con su formato numérico."""
    if isinstance(valor, Formula):
        celda.value = validar_formula(valor.formula, hojas, ubicacion)
        celda.number_format = formato or FORMATOS[tipo]
        return
    convertido = convertir_valor(valor, tipo, ubicacion)
    celda.value = convertido
    celda.number_format = formato_para(tipo, convertido, formato)


def escribir_hoja(hoja_xlsx: Worksheet, hoja: Hoja, hojas: Collection[str]) -> None:
    """Escribe encabezado y filas de datos con sus tipos reales."""
    for indice, columna in enumerate(hoja.columnas, start=1):
        hoja_xlsx.cell(row=1, column=indice, value=columna.nombre)
    for numero, fila in enumerate(hoja.filas, start=2):
        for indice, (columna, valor) in enumerate(zip(hoja.columnas, fila, strict=True), 1):
            escribir_celda(
                hoja_xlsx.cell(row=numero, column=indice),
                valor,
                columna.tipo,
                columna.formato,
                hojas=hojas,
                ubicacion=(
                    f"la hoja '{hoja.nombre}', fila {numero - 1}, columna '{columna.nombre}'"
                ),
            )


def renderizar_xlsx(planilla: Planilla, config: Configuracion) -> bytes:
    """Genera el libro completo en memoria y devuelve sus bytes."""
    verificar_filas(planilla.total_filas(), config)
    libro = Workbook()
    libro.remove(libro.worksheets[0])
    hojas = [hoja.nombre for hoja in planilla.hojas]
    for hoja in planilla.hojas:
        escribir_hoja(libro.create_sheet(hoja.nombre), hoja, hojas)
    libro.properties.creator = "ConvertiTodo"
    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()
