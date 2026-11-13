"""Entrada rápida desde tabla Markdown o CSV con tipos inferidos."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook

from convertitodo_mcp.blocks.planilla import Planilla, TipoColumna
from convertitodo_mcp.convert.texto_a_planilla import (
    hoja_desde_csv,
    hoja_desde_markdown,
    inferir_tipo,
)
from convertitodo_mcp.errores import ErrorArgumento
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.server.config import Configuracion


def test_markdown_del_fixture(fixture_bytes: Callable[[str], bytes]) -> None:
    hoja = hoja_desde_markdown(fixture_bytes("sample.md").decode(), "Detalle")
    assert [(c.nombre, c.tipo) for c in hoja.columnas] == [
        ("Producto", "texto"),
        ("Unidades", "entero"),
        ("Precio", "entero"),
    ]
    assert hoja.filas[0] == ["Café", "120", "100"]


def test_csv_del_fixture_genera_numeros_reales(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    hoja = hoja_desde_csv(fixture_bytes("sample.csv").decode())
    assert [c.tipo for c in hoja.columnas] == ["entero", "texto", "entero", "texto"]
    datos = renderizar_xlsx(Planilla(hojas=[hoja]), Configuracion(carpeta_trabajo=tmp_path))
    celda = load_workbook(BytesIO(datos))["Hoja1"]["C2"]
    assert celda.value == 3200
    assert celda.data_type == "n"


@pytest.mark.parametrize(
    ("valores", "tipo"),
    [
        (["1", "2", ""], "entero"),
        (["1,5", "2.25"], "numero"),
        (["$ 1.500,50", "€ 20"], "moneda"),
        (["15%", "2,5 %"], "porcentaje"),
        (["2026-01-31", "01/02/2026"], "fecha"),
        (["007", "12"], "texto"),
        (["+54 11 5555 1234"], "texto"),
        (["1234567890123456"], "texto"),
        (["10", "abc"], "texto"),
        (["", " "], "texto"),
        (["5%", "x%"], "texto"),
        (["0", "0,5"], "numero"),
    ],
)
def test_inferir_tipo(valores: list[str], tipo: TipoColumna) -> None:
    assert inferir_tipo(valores) == tipo


def test_csv_con_punto_y_coma_filas_cortas_y_encabezados_repetidos() -> None:
    hoja = hoja_desde_csv("Nombre;Monto;Monto;\nAna;1,5;2\n\nLuis;3\n", "Datos")
    assert [c.nombre for c in hoja.columnas] == ["Nombre", "Monto", "Monto (2)", "Columna 4"]
    assert [c.tipo for c in hoja.columnas] == ["texto", "numero", "entero", "texto"]
    assert hoja.filas == [["Ana", "1,5", "2", ""], ["Luis", "3", None, ""]]


@pytest.mark.parametrize(
    ("funcion", "texto", "mensaje"),
    [
        (hoja_desde_csv, "", "vacío"),
        (hoja_desde_csv, "a,b\n1,2,3\n", "fila 1"),
        (hoja_desde_markdown, "Sin tablas", "0 tablas"),
        (hoja_desde_markdown, "|a|\n|-|\n|1|\n\n|b|\n|-|\n|2|\n", "2 tablas"),
    ],
)
def test_errores_de_entrada(funcion: Callable[[str], object], texto: str, mensaje: str) -> None:
    with pytest.raises(ErrorArgumento, match=mensaje):
        funcion(texto)


def test_nombre_de_hoja_invalido() -> None:
    with pytest.raises(ErrorArgumento, match="No se pudo armar la hoja"):
        hoja_desde_csv("a\n1\n", "Hoja/1")
