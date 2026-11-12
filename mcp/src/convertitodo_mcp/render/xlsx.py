"""Renderizado de una planilla tipada a XLSX con openpyxl."""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.worksheet.worksheet import Worksheet

from convertitodo_mcp.blocks.planilla import Hoja, Planilla
from convertitodo_mcp.limites import verificar_filas
from convertitodo_mcp.render.xlsx_valores import convertir_valor, formato_para
from convertitodo_mcp.server.config import Configuracion


def escribir_hoja(hoja_xlsx: Worksheet, hoja: Hoja) -> None:
    """Escribe encabezado y filas de datos con sus tipos reales."""
    for indice, columna in enumerate(hoja.columnas, start=1):
        hoja_xlsx.cell(row=1, column=indice, value=columna.nombre)
    for numero, fila in enumerate(hoja.filas, start=2):
        for indice, (columna, valor) in enumerate(zip(hoja.columnas, fila, strict=True), 1):
            ubicacion = f"la hoja '{hoja.nombre}', fila {numero - 1}, columna '{columna.nombre}'"
            convertido = convertir_valor(valor, columna.tipo, ubicacion)
            celda = hoja_xlsx.cell(row=numero, column=indice, value=convertido)
            celda.number_format = formato_para(columna.tipo, convertido, columna.formato)


def renderizar_xlsx(planilla: Planilla, config: Configuracion) -> bytes:
    """Genera el libro completo en memoria y devuelve sus bytes."""
    verificar_filas(planilla.total_filas(), config)
    libro = Workbook()
    libro.remove(libro.worksheets[0])
    for hoja in planilla.hojas:
        escribir_hoja(libro.create_sheet(hoja.nombre), hoja)
    libro.properties.creator = "ConvertiTodo"
    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()
