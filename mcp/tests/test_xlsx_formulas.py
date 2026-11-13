"""Fórmulas explícitas: validación de sintaxis, funciones y referencias."""

from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from convertitodo_mcp.blocks.planilla import Planilla
from convertitodo_mcp.errores import ErrorArgumento
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.render.xlsx_formulas import validar_formula
from convertitodo_mcp.server.config import Configuracion

HOJAS = ["Ventas", "Mi hoja", "O'Brien"]


@pytest.mark.parametrize(
    ("formula", "esperada"),
    [
        ("=SUM(B2:B10)", "=SUM(B2:B10)"),
        (" B2*C2 ", "=B2*C2"),
        ("='Mi hoja'!$A$1+Ventas!A:A", "='Mi hoja'!$A$1+Ventas!A:A"),
        ("='O''Brien'!1:3", "='O''Brien'!1:3"),
        ('=IF(A1>0,"sí",NA())', '=IF(A1>0,"sí",NA())'),
        ("=IFERROR(VLOOKUP(A2,'mi HOJA'!A:B,2,FALSE),#N/A)", None),
        ("=XFD1048576", None),
        ('=SUBTOTAL(109,C2:C4)&" total"', None),
    ],
)
def test_acepta_formulas_validas(formula: str, esperada: str | None) -> None:
    resultado = validar_formula(formula, HOJAS, "la celda")
    assert resultado == (esperada or formula)


@pytest.mark.parametrize(
    ("formula", "mensaje"),
    [
        ("=SUM(A1", "paréntesis"),
        ("=SUM(A1))", "sintaxis"),
        ('="abc', "sintaxis"),
        ("=SUMA(A1:A3)", "usá SUM"),
        ("=NOEXISTE(A1)", "no se reconoce"),
        ('=HYPERLINK("http://x")', "no está permitida"),
        ('=INDIRECT("A1")', "no está permitida"),
        ("=Otra!A1", "no existe"),
        ("=[1]Ventas!A1", "otro libro"),
        ("='C:\\[libro.xlsx]Hoja'!A1", "otro libro"),
        ("=A1048577", "rango válido"),
        ("=XFE1", "rango válido"),
        ("=nombre_definido", "rango válido"),
        ("=A1:B2:C3", "rango válido"),
        ("=#REF!+1", "#REF!"),
        ("=", "vacía"),
        ("=A1\n+B1", "vacía"),
    ],
)
def test_rechaza_formulas_invalidas(formula: str, mensaje: str) -> None:
    with pytest.raises(ErrorArgumento, match="la celda") as error:
        validar_formula(formula, HOJAS, "la celda")
    assert mensaje in str(error.value)


def test_formulas_se_guardan_como_formulas(tmp_path: Path) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Ventas",
                    "columnas": [
                        {"nombre": "Precio", "tipo": "moneda"},
                        {"nombre": "Cantidad", "tipo": "entero"},
                        {"nombre": "Total", "tipo": "moneda"},
                    ],
                    "filas": [
                        [10, 2, {"formula": "=A2*B2"}],
                        [5.5, 3, {"formula": "A3*B3"}],
                    ],
                },
                {
                    "nombre": "Resumen",
                    "columnas": [{"nombre": "Total", "tipo": "moneda"}],
                    "filas": [[{"formula": "=SUM(Ventas!C2:C3)"}]],
                },
            ]
        }
    )
    libro = load_workbook(
        BytesIO(renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path)))
    )
    ventas = libro["Ventas"]
    assert ventas["C2"].data_type == "f"
    assert ventas["C2"].value == "=A2*B2"
    assert ventas["C3"].value == "=A3*B3"
    assert ventas["C2"].number_format == '"$" #,##0.00'
    assert libro["Resumen"]["A2"].value == "=SUM(Ventas!C2:C3)"


def test_formula_con_hoja_inexistente_indica_ubicacion(tmp_path: Path) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Datos",
                    "columnas": [{"nombre": "A", "tipo": "numero"}],
                    "filas": [[{"formula": "=Falta!A1"}]],
                }
            ]
        }
    )
    with pytest.raises(ErrorArgumento, match="la hoja 'Datos', fila 1, columna 'A'"):
        renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path))


@pytest.mark.parametrize(
    "texto", ["=1+1", "+54 11 5555", "-x", "@SUM(A1)", "\tcmd", "\r=2", '=HYPERLINK("http://x")']
)
def test_texto_que_parece_formula_se_guarda_como_texto(tmp_path: Path, texto: str) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Datos",
                    "columnas": [{"nombre": texto}, {"nombre": "Normal"}],
                    "filas": [[texto, "texto común"]],
                }
            ]
        }
    )
    hoja = load_workbook(
        BytesIO(renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path)))
    )["Datos"]
    for celda in (hoja["A1"], hoja["A2"]):
        assert celda.value == texto
        assert celda.data_type == "s"
        assert celda.quotePrefix is True
    assert hoja["B2"].quotePrefix is False


def test_numero_negativo_en_columna_numerica_sigue_siendo_numero(tmp_path: Path) -> None:
    planilla = Planilla.model_validate(
        {
            "hojas": [
                {
                    "nombre": "Datos",
                    "columnas": [{"nombre": "Saldo", "tipo": "numero"}],
                    "filas": [["-12,5"]],
                }
            ]
        }
    )
    celda = load_workbook(
        BytesIO(renderizar_xlsx(planilla, Configuracion(carpeta_trabajo=tmp_path)))
    )["Datos"]["A2"]
    assert celda.value == -12.5
    assert celda.data_type == "n"
