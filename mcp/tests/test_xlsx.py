"""Renderizado de planillas a XLSX con tipos y formatos reales."""

from datetime import date, datetime
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from convertitodo_mcp.blocks.planilla import Planilla, TipoColumna, ValorSimple
from convertitodo_mcp.errores import ErrorArgumento, ErrorLimiteExcedido
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.render.xlsx_valores import convertir_valor
from convertitodo_mcp.server.config import Configuracion


def _config(tmp_path: Path, max_filas: int = 10000) -> Configuracion:
    return Configuracion(carpeta_trabajo=tmp_path, max_filas=max_filas)


def test_tipos_reales_y_formatos_por_defecto(tmp_path: Path) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Ventas",
                    "columnas": [
                        {"nombre": "Producto"},
                        {"nombre": "Cantidad", "tipo": "entero"},
                        {"nombre": "Precio", "tipo": "moneda"},
                        {"nombre": "Peso", "tipo": "numero", "formato": "0.000"},
                        {"nombre": "Descuento", "tipo": "porcentaje"},
                        {"nombre": "Fecha", "tipo": "fecha"},
                    ],
                    "filas": [
                        ["Café", "1.200,0", "$ 1.234,50", "2,5", "15%", "2026-11-12"],
                        ["Té", 3, 99.9, 1, 0.2, "31/12/2025 18:30"],
                        [None, None, None, None, None, None],
                    ],
                }
            ]
        }
    )
    hoja = load_workbook(BytesIO(renderizar_xlsx(planilla, _config(tmp_path))))["Ventas"]
    assert [celda.value for celda in hoja[1]] == [
        "Producto",
        "Cantidad",
        "Precio",
        "Peso",
        "Descuento",
        "Fecha",
    ]
    fila = hoja[2]
    assert [celda.data_type for celda in fila] == ["s", "n", "n", "n", "n", "d"]
    assert fila[1].value == 1200
    assert fila[2].value == pytest.approx(1234.5)
    assert fila[3].value == pytest.approx(2.5)
    assert fila[4].value == pytest.approx(0.15)
    assert fila[5].value == datetime(2026, 11, 12)
    assert [celda.number_format for celda in fila] == [
        "General",
        "#,##0",
        '"$" #,##0.00',
        "0.000",
        "0.00%",
        "dd/mm/yyyy",
    ]
    assert hoja["F3"].value == datetime(2025, 12, 31, 18, 30)
    assert hoja["F3"].number_format == "dd/mm/yyyy hh:mm"
    assert all(celda.value is None for celda in hoja[4])


@pytest.mark.parametrize(
    ("valor", "tipo", "esperado"),
    [
        ("1,234.56", "numero", 1234.56),
        ("1.234.567", "numero", 1234567),
        ("-0,5", "numero", -0.5),
        ("1e3", "numero", 1000.0),
        ("€ 10", "moneda", 10),
        ("12,5 %", "porcentaje", 0.125),
        (7.0, "entero", 7),
        ("2026-01-02T03:04", "fecha", datetime(2026, 1, 2, 3, 4)),
        ("2-1-2026", "fecha", date(2026, 1, 2)),
        (12, "texto", 12),
        (True, "texto", True),
        ("  ", "numero", None),
        ("  ", "texto", "  "),
    ],
)
def test_convierte_valores(valor: ValorSimple, tipo: TipoColumna, esperado: object) -> None:
    assert convertir_valor(valor, tipo, "la celda") == esperado


@pytest.mark.parametrize(
    ("valor", "tipo"),
    [
        ("abc", "numero"),
        (True, "numero"),
        ("1,2,3.4.5", "numero"),
        (1.5, "entero"),
        (float("inf"), "numero"),
        (20261112, "fecha"),
        ("31/02/2026", "fecha"),
        ("1899-12-31", "fecha"),
        ("2026-01-01T00:00+03:00", "fecha"),
        ("quince %", "porcentaje"),
    ],
)
def test_rechaza_valores_que_no_corresponden_al_tipo(valor: ValorSimple, tipo: TipoColumna) -> None:
    with pytest.raises(ErrorArgumento, match="la celda"):
        convertir_valor(valor, tipo, "la celda")


def test_error_indica_hoja_fila_y_columna(tmp_path: Path) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Datos",
                    "columnas": [{"nombre": "Monto", "tipo": "numero"}],
                    "filas": [[1], ["mucho"]],
                }
            ]
        }
    )
    with pytest.raises(ErrorArgumento) as error:
        renderizar_xlsx(planilla, _config(tmp_path))
    assert "la hoja 'Datos', fila 2, columna 'Monto'" in str(error.value)


def test_limite_de_filas_por_hoja(tmp_path: Path) -> None:
    hoja = {"columnas": [{"nombre": "A"}], "filas": [["x"]] * 3}
    planilla = Planilla.model_validate(
        {"hojas": [{"nombre": "Uno", **hoja}, {"nombre": "Dos", **hoja}]}
    )
    renderizar_xlsx(planilla, _config(tmp_path, max_filas=3))
    with pytest.raises(ErrorLimiteExcedido, match="La hoja 'Uno' tiene 3 filas"):
        renderizar_xlsx(planilla, _config(tmp_path, max_filas=2))
