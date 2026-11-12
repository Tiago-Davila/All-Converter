"""Renderizado de una planilla tipada a XLSX con openpyxl."""

from collections.abc import Collection
from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.cell.cell import Cell
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import BaseModel, ConfigDict, Field, field_validator

from convertitodo_mcp.blocks.planilla import (
    Columna,
    Formula,
    Hoja,
    Planilla,
    TipoColumna,
    Valor,
)
from convertitodo_mcp.limites import verificar_filas
from convertitodo_mcp.render.xlsx_formulas import validar_formula
from convertitodo_mcp.render.xlsx_valores import (
    FORMATOS,
    ValorCelda,
    convertir_valor,
    formato_para,
)
from convertitodo_mcp.server.config import Configuracion

# Prefijos que una aplicación de planillas podría interpretar como fórmula o comando.
PREFIJOS_PELIGROSOS = ("=", "+", "-", "@", "\t", "\r")


def asignar_literal(celda: Cell, valor: ValorCelda) -> None:
    """Asigna un literal; un texto que parece fórmula queda guardado como texto."""
    celda.value = valor
    if isinstance(valor, str) and valor.startswith(PREFIJOS_PELIGROSOS):
        # openpyxl marca como fórmula todo texto que empieza con '='; se fuerza texto y se
        # agrega el apóstrofo invisible para que Excel no lo evalúe al editar la celda.
        celda.data_type = "s"
        celda.quotePrefix = True


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
    asignar_literal(celda, convertido)
    celda.number_format = formato_para(tipo, convertido, formato)


class OpcionesXLSX(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estilo_encabezado: bool = Field(
        default=True, description="Encabezado en negrita, con fondo y borde inferior."
    )
    congelar_encabezado: bool = Field(
        default=True, description="Inmoviliza la fila de encabezado al desplazarse."
    )
    autofiltro: bool = Field(default=True, description="Agrega filtros al encabezado.")
    ancho_automatico: bool = Field(
        default=True, description="Ajusta el ancho de cada columna a su contenido."
    )
    simbolo_moneda: str = Field(
        default="$",
        min_length=1,
        max_length=5,
        description="Símbolo de las columnas de tipo moneda, por ejemplo '$', '€' o 'US$'.",
    )

    # El símbolo se inserta entre comillas en el código de formato de Excel.
    @field_validator("simbolo_moneda")
    @classmethod
    def _validar_simbolo(cls, valor: str) -> str:
        if any(c in '"\\' or ord(c) < 32 for c in valor):
            raise ValueError("El símbolo de moneda no puede tener comillas, \\ ni controles.")
        return valor


_ANCHO_MINIMO = 8
_ANCHO_MAXIMO = 60
_RELLENO = PatternFill(fill_type="solid", start_color="1F4E78", end_color="1F4E78")
_FUENTE = Font(bold=True, color="FFFFFF")
_BORDE = Border(bottom=Side(style="medium", color="000000"))


def formato_columna(columna: Columna, opciones: OpcionesXLSX) -> str | None:
    """Formato explícito de la columna o, para moneda, el que usa el símbolo elegido."""
    if columna.formato is None and columna.tipo == "moneda":
        return f'"{opciones.simbolo_moneda}" #,##0.00'
    return columna.formato


# Estima los caracteres visibles de un valor ya formateado por Excel.
def _ancho_valor(valor: object) -> int:
    if valor is None:
        return 0
    if isinstance(valor, datetime):
        return 16
    if isinstance(valor, date):
        return 10
    if isinstance(valor, bool):
        return 5
    if isinstance(valor, int | float):
        return len(f"{valor:,.2f}") + 2
    texto = str(valor)
    if texto.startswith("="):
        return 12
    return max(len(linea) for linea in texto.splitlines() or [""])


def aplicar_formato(hoja_xlsx: Worksheet, hoja: Hoja, opciones: OpcionesXLSX) -> None:
    """Aplica estilo de encabezado, paneles, autofiltro y anchos a una hoja escrita."""
    columnas = len(hoja.columnas)
    ultima = get_column_letter(columnas)
    if opciones.estilo_encabezado:
        for celda in hoja_xlsx[1][:columnas]:
            celda.font = _FUENTE
            celda.fill = _RELLENO
            celda.border = _BORDE
            celda.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    if opciones.congelar_encabezado:
        hoja_xlsx.freeze_panes = "A2"
    if opciones.autofiltro:
        hoja_xlsx.auto_filter.ref = f"A1:{ultima}{len(hoja.filas) + 1}"
    for indice, columna in enumerate(hoja.columnas, start=1):
        letra = get_column_letter(indice)
        ancho = columna.ancho
        if ancho is None and opciones.ancho_automatico:
            celdas = hoja_xlsx.iter_rows(
                min_row=1, max_row=len(hoja.filas) + 1, min_col=indice, max_col=indice
            )
            # El encabezado suma espacio para el botón del autofiltro.
            contenido = max(
                len(columna.nombre) + 3,
                *(_ancho_valor(fila[0].value) for fila in celdas),
            )
            ancho = min(max(contenido + 2, _ANCHO_MINIMO), _ANCHO_MAXIMO)
        if ancho is not None:
            hoja_xlsx.column_dimensions[letra].width = ancho


def escribir_hoja(
    hoja_xlsx: Worksheet,
    hoja: Hoja,
    hojas: Collection[str],
    opciones: OpcionesXLSX | None = None,
) -> None:
    """Escribe encabezado y filas de datos con sus tipos reales y aplica el formato."""
    opciones = opciones or OpcionesXLSX()
    formatos = [formato_columna(columna, opciones) for columna in hoja.columnas]
    for indice, columna in enumerate(hoja.columnas, start=1):
        asignar_literal(hoja_xlsx.cell(row=1, column=indice), columna.nombre)
    for numero, fila in enumerate(hoja.filas, start=2):
        for indice, (columna, formato, valor) in enumerate(
            zip(hoja.columnas, formatos, fila, strict=True), 1
        ):
            escribir_celda(
                hoja_xlsx.cell(row=numero, column=indice),
                valor,
                columna.tipo,
                formato,
                hojas=hojas,
                ubicacion=(
                    f"la hoja '{hoja.nombre}', fila {numero - 1}, columna '{columna.nombre}'"
                ),
            )
    aplicar_formato(hoja_xlsx, hoja, opciones)


def renderizar_xlsx(
    planilla: Planilla, config: Configuracion, opciones: OpcionesXLSX | None = None
) -> bytes:
    """Genera el libro completo en memoria y devuelve sus bytes."""
    verificar_filas(planilla.total_filas(), config)
    libro = Workbook()
    libro.remove(libro.worksheets[0])
    hojas = [hoja.nombre for hoja in planilla.hojas]
    for hoja in planilla.hojas:
        escribir_hoja(libro.create_sheet(hoja.nombre), hoja, hojas, opciones)
    libro.properties.creator = "ConvertiTodo"
    salida = BytesIO()
    libro.save(salida)
    return salida.getvalue()
