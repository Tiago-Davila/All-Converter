"""Formato visual de las hojas generadas."""

from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import ValidationError

from convertitodo_mcp.blocks.planilla import Planilla
from convertitodo_mcp.render.xlsx import OpcionesXLSX, renderizar_xlsx
from convertitodo_mcp.server.config import Configuracion

PLANILLA = {
    "hojas": [
        {
            "nombre": "Ventas",
            "columnas": [
                {"nombre": "Producto"},
                {"nombre": "Precio", "tipo": "moneda"},
                {"nombre": "Fijo", "ancho": 30},
                {"nombre": "Comentario largo"},
            ],
            "filas": [
                ["Café de especialidad", 1234.5, "a", "x" * 200],
                ["Té", 10, "b", None],
            ],
        }
    ]
}


def _hoja(tmp_path: Path, opciones: OpcionesXLSX | None = None) -> Worksheet:
    planilla = Planilla.model_validate(PLANILLA)
    datos = renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path), opciones)
    hoja = load_workbook(BytesIO(datos))["Ventas"]
    assert isinstance(hoja, Worksheet)
    return hoja


def test_formato_por_defecto(tmp_path: Path) -> None:
    hoja = _hoja(tmp_path)
    encabezado = hoja["A1"]
    assert encabezado.font.bold is True
    assert encabezado.fill.fill_type == "solid"
    assert encabezado.border.bottom.style == "medium"
    assert hoja["A2"].font.bold is False
    assert hoja.freeze_panes == "A2"
    assert hoja.auto_filter.ref == "A1:D3"
    anchos = {letra: hoja.column_dimensions[letra].width for letra in "ABCD"}
    assert anchos["A"] == pytest.approx(len("Café de especialidad") + 2)
    assert anchos["C"] == 30
    assert anchos["D"] == 60
    assert anchos["B"] >= len("1,234.50")
    assert hoja["B2"].number_format == '"$" #,##0.00'


def test_opciones_desactivan_formato_y_cambian_moneda(tmp_path: Path) -> None:
    opciones = OpcionesXLSX(
        estilo_encabezado=False,
        congelar_encabezado=False,
        autofiltro=False,
        ancho_automatico=False,
        simbolo_moneda="€",
    )
    hoja = _hoja(tmp_path, opciones)
    assert hoja["A1"].font.bold is False
    assert hoja.freeze_panes is None
    assert hoja.auto_filter.ref is None
    assert hoja.column_dimensions["A"].width == 13
    assert hoja.column_dimensions["C"].width == 30
    assert hoja["B2"].number_format == '"€" #,##0.00'


@pytest.mark.parametrize("simbolo", ['"', "\\", "", "MONEDA", "$\n"])
def test_rechaza_simbolos_de_moneda_invalidos(simbolo: str) -> None:
    with pytest.raises(ValidationError):
        OpcionesXLSX(simbolo_moneda=simbolo)
