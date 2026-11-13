"""Operaciones de edición sobre una copia de un libro XLSX existente."""

import re
from copy import copy
from datetime import datetime
from io import BytesIO
from typing import Annotated, Literal, cast

from openpyxl import Workbook, load_workbook
from openpyxl.cell.cell import Cell, MergedCell
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.styles.numbers import is_date_format
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel, ConfigDict, Field

from convertitodo_mcp.blocks.planilla import (
    MAX_COLUMNAS_EXCEL,
    MAX_FILAS_EXCEL,
    Formula,
    Hoja,
    TipoColumna,
    Valor,
)
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado
from convertitodo_mcp.limites import verificar_filas
from convertitodo_mcp.read.deteccion import cargar_entrada
from convertitodo_mcp.render.xlsx import asignar_literal, escribir_hoja
from convertitodo_mcp.render.xlsx_formulas import validar_formula
from convertitodo_mcp.render.xlsx_valores import FORMATO_FECHA_HORA, convertir_valor
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


class AgregarFilas(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["agregar_filas"]
    hoja: str = Field(min_length=1, description="Nombre de la hoja existente.")
    filas: list[list[Valor]] = Field(
        min_length=1, description="Filas que se agregan debajo de los datos."
    )


class AgregarHoja(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["agregar_hoja"]
    hoja: Hoja = Field(description="Hoja nueva con el mismo esquema que crear_xlsx.")


class Celda(BaseModel):
    model_config = ConfigDict(extra="forbid")
    celda: str = Field(pattern=r"^[A-Za-z]{1,3}[1-9]\d{0,6}$", description="Celda, como B3.")
    valor: Valor = Field(description="Valor literal, null para vaciar, o una fórmula.")


class EscribirCeldas(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["escribir_celdas"]
    hoja: str = Field(min_length=1, description="Nombre de la hoja existente.")
    celdas: list[Celda] = Field(min_length=1, description="Celdas que se escriben.")


OperacionXLSX = Annotated[AgregarFilas | AgregarHoja | EscribirCeldas, Field(discriminator="tipo")]

_TOTAL = re.compile(r"=SUBTOTAL\(109,([A-Z]{1,3})2:\1(\d+)\)")


def contar_filas(operaciones: list[OperacionXLSX]) -> int:
    """Filas o celdas que agregan las operaciones, para limitar el trabajo antes de abrir."""
    total = 0
    for operacion in operaciones:
        if isinstance(operacion, AgregarFilas):
            total += len(operacion.filas)
        elif isinstance(operacion, AgregarHoja):
            total += len(operacion.hoja.filas)
        else:
            total += len(operacion.celdas)
    return total


def cargar_libro(archivo: str, almacen: Almacen, config: Configuracion) -> Workbook:
    """Abre un XLSX local validado; nunca carga macros ni vínculos externos."""
    entrada = cargar_entrada(archivo, almacen, config)
    if entrada.tipo != "xlsx":
        raise ErrorFormatoNoSoportado(
            f"El archivo es {entrada.tipo.upper()} y editar_xlsx solo edita Excel.",
            "indicá el id de un archivo XLSX.",
        )
    try:
        return load_workbook(BytesIO(entrada.datos), keep_links=False, keep_vba=False)
    except Exception:
        raise ErrorFormatoNoSoportado(
            "No se pudo abrir el Excel.", "exportalo otra vez como XLSX y volvé a subirlo."
        ) from None


def _hoja(libro: Workbook, nombre: str) -> Worksheet:
    for hoja in libro.worksheets:
        if hoja.title.lower() == nombre.lower() and isinstance(hoja, Worksheet):
            return hoja
    disponibles = ", ".join(hoja.title for hoja in libro.worksheets)
    raise ErrorArgumento(
        f"La hoja '{nombre}' no existe en el libro.", f"usá una de estas hojas: {disponibles}."
    )


def _tablas(libro: Workbook) -> list[str]:
    return [nombre for hoja in libro.worksheets for nombre in getattr(hoja, "tables", {})]


def _tipo_por_referencia(referencia: Cell | None) -> TipoColumna:
    """Deduce el tipo de una celda nueva a partir de la celda que le sirve de modelo."""
    if referencia is None:
        return "texto"
    formato = referencia.number_format
    if is_date_format(formato):
        return "fecha"
    if "%" in formato:
        return "porcentaje"
    valor = referencia.value
    es_numero = isinstance(valor, int | float) and not isinstance(valor, bool)
    if es_numero or (referencia.data_type == "f" and formato != "General"):
        return "numero"
    return "texto"


def _escribir(
    celda: Cell, valor: Valor, referencia: Cell | None, libro: Workbook, ubicacion: str
) -> None:
    if referencia is not None and referencia is not celda:
        # La celda nueva hereda fuente, borde, relleno y formato de la celda modelo.
        celda._style = copy(referencia._style)
    formato = referencia.number_format if referencia is not None else "General"
    if isinstance(valor, Formula):
        hojas = [hoja.title for hoja in libro.worksheets]
        celda.value = validar_formula(valor.formula, hojas, ubicacion, _tablas(libro))
        return
    convertido = convertir_valor(valor, _tipo_por_referencia(referencia), ubicacion)
    asignar_literal(celda, convertido)
    # Una fecha con hora necesita un formato que muestre la hora.
    con_hora = isinstance(convertido, datetime) and "h" not in formato.lower()
    celda.number_format = FORMATO_FECHA_HORA if con_hora else formato


def _extender(ref: str, fila_vieja: int, fila_nueva: int) -> str:
    """Estira un rango que terminaba en la última fila de datos hasta la nueva última fila."""
    partes: list[str] = []
    for rango in ref.split():
        min_col, min_row, max_col, max_row = range_boundaries(rango)
        if max_row == fila_vieja and min_col is not None and max_col is not None:
            rango = (
                f"{get_column_letter(min_col)}{min_row}:{get_column_letter(max_col)}{fila_nueva}"
            )
        partes.append(rango)
    return " ".join(partes)


def _fila_totales(hoja: Worksheet) -> int | None:
    fila: int = hoja.max_row
    for celda in hoja[fila]:
        coincidencia = _TOTAL.fullmatch(str(celda.value or ""))
        if coincidencia and int(coincidencia[2]) == fila - 1:
            return fila
    return None


def _agregar_filas(libro: Workbook, operacion: AgregarFilas, config: Configuracion) -> None:
    hoja = _hoja(libro, operacion.hoja)
    columnas = max(hoja.max_column, max(len(fila) for fila in operacion.filas))
    if columnas > MAX_COLUMNAS_EXCEL:
        raise ErrorArgumento("Las filas superan las columnas de Excel.", "enviá menos valores.")
    totales = _fila_totales(hoja)
    ultima_datos = (totales or hoja.max_row + 1) - 1
    cantidad = len(operacion.filas)
    nueva_ultima = ultima_datos + cantidad
    verificar_filas(nueva_ultima - 1, config, que=f"la hoja '{hoja.title}'")
    if nueva_ultima + 1 > MAX_FILAS_EXCEL:
        raise ErrorArgumento("La hoja superaría las filas de Excel.", "dividí los datos.")
    if totales is not None:
        # La fila de totales baja debajo de los datos nuevos y suma también esas filas.
        for celda in list(hoja[totales]):
            destino = hoja.cell(row=nueva_ultima + 1, column=celda.column)
            destino._style = copy(celda._style)
            destino.value = celda.value
            coincidencia = _TOTAL.fullmatch(str(celda.value or ""))
            if coincidencia:
                letra = coincidencia[1]
                destino.value = f"=SUBTOTAL(109,{letra}2:{letra}{nueva_ultima})"
            celda.value = None
            celda.style = "Normal"
    for desplazamiento, fila in enumerate(operacion.filas, start=1):
        numero = ultima_datos + desplazamiento
        for indice, valor in enumerate(fila, start=1):
            referencia = hoja.cell(row=ultima_datos, column=indice) if ultima_datos > 1 else None
            _escribir(
                hoja.cell(row=numero, column=indice),
                valor,
                referencia,
                libro,
                f"la hoja '{hoja.title}', fila agregada {desplazamiento}, columna {indice}",
            )
    for tabla in hoja.tables.values():
        tabla.ref = _extender(tabla.ref, ultima_datos, nueva_ultima)
        if tabla.autoFilter is not None:
            tabla.autoFilter.ref = tabla.ref
    if hoja.auto_filter.ref:
        hoja.auto_filter.ref = _extender(hoja.auto_filter.ref, ultima_datos, nueva_ultima)
    reglas = [(str(rango.sqref), list(rango.rules)) for rango in hoja.conditional_formatting]
    hoja.conditional_formatting = ConditionalFormattingList()
    for sqref, lista in reglas:
        for regla in lista:
            hoja.conditional_formatting.add(_extender(sqref, ultima_datos, nueva_ultima), regla)


def _escribir_celdas(libro: Workbook, operacion: EscribirCeldas) -> None:
    hoja = _hoja(libro, operacion.hoja)
    encabezados: set[tuple[int, int]] = set()
    for tabla in hoja.tables.values():
        primera_col, fila_encabezado, ultima_col, _ = range_boundaries(tabla.ref)
        if primera_col is not None and fila_encabezado is not None and ultima_col is not None:
            encabezados.update(
                (fila_encabezado, columna) for columna in range(primera_col, ultima_col + 1)
            )
    for item in operacion.celdas:
        referencia = item.celda.upper()
        min_col, fila, _, _ = range_boundaries(referencia)
        if (
            min_col is None
            or fila is None
            or min_col > MAX_COLUMNAS_EXCEL
            or fila > MAX_FILAS_EXCEL
        ):
            raise ErrorArgumento(
                f"La celda {referencia} está fuera de los límites de Excel.",
                "usá una celda entre A1 y XFD1048576.",
            )
        if (fila, min_col) in encabezados:
            raise ErrorArgumento(
                f"La celda {referencia} es encabezado de una tabla de Excel.",
                "escribí en las celdas de datos; los encabezados de tabla no se cambian.",
            )
        celda = hoja[referencia]
        if isinstance(celda, MergedCell):
            raise ErrorArgumento(
                f"La celda {referencia} forma parte de un rango combinado.",
                "escribí en la primera celda del rango combinado.",
            )
        modelo: Cell | None = celda
        if celda.value is None and celda.number_format == "General" and fila > 2:
            # Una celda vacía toma el tipo y el estilo de la celda de arriba.
            arriba = hoja.cell(row=fila - 1, column=min_col)
            modelo = cast(Cell, arriba) if not isinstance(arriba, MergedCell) else None
        _escribir(celda, item.valor, modelo, libro, f"la hoja '{hoja.title}', celda {referencia}")


def _agregar_hoja(libro: Workbook, operacion: AgregarHoja, config: Configuracion) -> None:
    hoja = operacion.hoja
    if hoja.nombre.lower() in {existente.title.lower() for existente in libro.worksheets}:
        raise ErrorArgumento(
            f"Ya existe una hoja llamada '{hoja.nombre}'.", "elegí otro nombre para la hoja."
        )
    tablas = _tablas(libro)
    if hoja.tabla is not None and hoja.tabla.lower() in {tabla.lower() for tabla in tablas}:
        raise ErrorArgumento(
            f"Ya existe una tabla llamada '{hoja.tabla}'.", "elegí otro nombre para la tabla."
        )
    verificar_filas(len(hoja.filas), config, que=f"la hoja '{hoja.nombre}'")
    hojas = [existente.title for existente in libro.worksheets] + [hoja.nombre]
    nuevas_tablas = tablas + ([hoja.tabla] if hoja.tabla is not None else [])
    escribir_hoja(libro.create_sheet(hoja.nombre), hoja, hojas, tablas=nuevas_tablas)


def editar_libro(
    libro: Workbook, operaciones: list[OperacionXLSX], *, config: Configuracion
) -> bytes:
    """Aplica las operaciones en orden y devuelve los bytes de la copia editada."""
    for operacion in operaciones:
        if isinstance(operacion, AgregarFilas):
            _agregar_filas(libro, operacion, config)
        elif isinstance(operacion, AgregarHoja):
            _agregar_hoja(libro, operacion, config)
        else:
            _escribir_celdas(libro, operacion)
    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()
