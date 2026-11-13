"""Extras opcionales: fila de totales, formato condicional y tabla con nombre."""

from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import ValidationError

from convertitodo_mcp.blocks.planilla import Hoja, Planilla
from convertitodo_mcp.errores import ErrorArgumento
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.server.config import Configuracion

COLUMNAS = [
    {"nombre": "Producto"},
    {"nombre": "Cantidad", "tipo": "entero"},
    {"nombre": "Precio", "tipo": "moneda"},
    {"nombre": "Margen", "tipo": "porcentaje"},
]
FILAS = [["Café", 2, 1500, 0.3], ["Té", 5, 800, 0.1]]


def _render(tmp_path: Path, *hojas: dict[str, object]) -> dict[str, Worksheet]:
    planilla = Planilla.model_validate({"hojas": list(hojas)})
    libro = load_workbook(
        BytesIO(renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path)))
    )
    return {hoja.title: hoja for hoja in libro.worksheets}


def test_fila_de_totales_suma_solo_columnas_sumables(tmp_path: Path) -> None:
    hoja = _render(
        tmp_path, {"nombre": "Ventas", "columnas": COLUMNAS, "filas": FILAS, "fila_totales": True}
    )["Ventas"]
    assert [celda.value for celda in hoja[4]] == [
        "Total",
        "=SUBTOTAL(109,B2:B3)",
        "=SUBTOTAL(109,C2:C3)",
        None,
    ]
    assert hoja["C4"].number_format == '"$" #,##0.00'
    assert hoja["A4"].font.bold is True
    assert hoja.auto_filter.ref == "A1:D3"


def test_formato_condicional(tmp_path: Path) -> None:
    hoja = _render(
        tmp_path,
        {
            "nombre": "Ventas",
            "columnas": COLUMNAS,
            "filas": FILAS,
            "formato_condicional": [
                {"columna": "Precio", "operador": "mayor", "valor": 1000},
                {
                    "columna": "Margen",
                    "operador": "entre",
                    "valor": 0.1,
                    "valor2": 0.2,
                    "color": "#c6efce",
                },
            ],
        },
    )["Ventas"]
    reglas = {
        str(rango.sqref): regla for rango in hoja.conditional_formatting for regla in rango.rules
    }
    assert set(reglas) == {"C2:C3", "D2:D3"}
    assert reglas["C2:C3"].operator == "greaterThan"
    assert reglas["C2:C3"].formula == ["1000.0"]
    assert reglas["D2:D3"].operator == "between"
    assert reglas["D2:D3"].formula == ["0.1", "0.2"]
    assert reglas["D2:D3"].dxf.fill.fgColor.rgb.endswith("C6EFCE")


def test_tabla_con_nombre_y_referencias_estructuradas(tmp_path: Path) -> None:
    hojas = _render(
        tmp_path,
        {
            "nombre": "Ventas",
            "columnas": COLUMNAS,
            "filas": FILAS,
            "tabla": "Ventas2026",
            "fila_totales": True,
        },
        {
            "nombre": "Resumen",
            "columnas": [{"nombre": "Total", "tipo": "moneda"}],
            "filas": [[{"formula": "=SUM(Ventas2026[Precio])"}]],
        },
    )
    ventas = hojas["Ventas"]
    tabla = ventas.tables["Ventas2026"]
    assert tabla.ref == "A1:D3"
    assert tabla.tableStyleInfo.name == "TableStyleMedium2"
    assert ventas.auto_filter.ref is None
    assert ventas["B4"].value == "=SUBTOTAL(109,B2:B3)"
    assert hojas["Resumen"]["A2"].value == "=SUM(Ventas2026[Precio])"


def test_referencia_a_tabla_inexistente(tmp_path: Path) -> None:
    with pytest.raises(ErrorArgumento, match="la tabla 'Otra' no existe"):
        _render(
            tmp_path,
            {
                "nombre": "Datos",
                "columnas": [{"nombre": "A", "tipo": "numero"}],
                "filas": [[{"formula": "=SUM(Otra[A])"}]],
            },
        )


@pytest.mark.parametrize(
    "extra",
    [
        {"tabla": "A1"},
        {"tabla": "R1C1"},
        {"tabla": "C"},
        {"tabla": "1Tabla"},
        {"tabla": "Mi tabla"},
        {"tabla": "Vacia", "filas": []},
        {"formato_condicional": [{"columna": "Producto", "operador": "mayor", "valor": 1}]},
        {"formato_condicional": [{"columna": "Falta", "operador": "mayor", "valor": 1}]},
        {"formato_condicional": [{"columna": "Precio", "operador": "entre", "valor": 1}]},
        {
            "formato_condicional": [
                {"columna": "Precio", "operador": "entre", "valor": 5, "valor2": 1}
            ]
        },
        {
            "formato_condicional": [
                {"columna": "Precio", "operador": "mayor", "valor": 1, "valor2": 2}
            ]
        },
        {
            "formato_condicional": [
                {"columna": "Precio", "operador": "mayor", "valor": 1, "color": "rojo"}
            ]
        },
    ],
)
def test_rechaza_extras_invalidos(extra: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Hoja.model_validate({"nombre": "Ventas", "columnas": COLUMNAS, "filas": FILAS, **extra})


def test_rechaza_tablas_repetidas() -> None:
    hoja = {"columnas": COLUMNAS, "filas": FILAS, "tabla": "Datos"}
    with pytest.raises(ValidationError, match="tablas con el mismo nombre"):
        Planilla.model_validate(
            {"hojas": [{"nombre": "Uno", **hoja}, {"nombre": "Dos", **hoja, "tabla": "DATOS"}]}
        )
