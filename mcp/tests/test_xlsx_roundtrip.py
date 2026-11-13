"""Ida y vuelta: generar XLSX, releerlo con openpyxl y recalcular con LibreOffice."""

import shutil
import subprocess
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from openpyxl.workbook.workbook import Workbook
from pydantic import TypeAdapter

from convertitodo_mcp.blocks.planilla import Planilla
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.render.xlsx_edit import OperacionXLSX, cargar_libro, editar_libro
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

SOFFICE = shutil.which("soffice") or shutil.which("libreoffice")

PLANILLA = Planilla.model_validate(
    {
        "hojas": [
            {
                "nombre": "Ventas",
                "columnas": [
                    {"nombre": "Producto"},
                    {"nombre": "Cantidad", "tipo": "entero"},
                    {"nombre": "Precio", "tipo": "moneda"},
                    {"nombre": "Descuento", "tipo": "porcentaje"},
                    {"nombre": "Subtotal", "tipo": "moneda"},
                    {"nombre": "Fecha", "tipo": "fecha"},
                ],
                "filas": [
                    ["Café", 2, "1.500,50", "10%", {"formula": "=B2*C2*(1-D2)"}, "2026-01-15"],
                    ["Té", "3", 800, 0.25, {"formula": "=B3*C3*(1-D3)"}, "16/01/2026"],
                    ["=SUM(A1)", 1, 100, 0, {"formula": "=B4*C4*(1-D4)"}, None],
                ],
                "fila_totales": True,
                "tabla": "Ventas2026",
                "formato_condicional": [
                    {"columna": "Subtotal", "operador": "mayor", "valor": 2000}
                ],
            },
            {
                "nombre": "Resumen general",
                "columnas": [
                    {"nombre": "Concepto"},
                    {"nombre": "Valor", "tipo": "numero"},
                ],
                "filas": [
                    ["Total", {"formula": "=SUM(Ventas2026[Subtotal])"}],
                    ["Unidades", {"formula": "=SUM(Ventas!B2:B4)"}],
                    ["Promedio", {"formula": "=ROUND(AVERAGE(Ventas!C2:C4),2)"}],
                    ["Condicional", {"formula": '=IF(B2>3000,"alto","bajo")'}],
                ],
            },
        ]
    }
)

# Subtotales esperados: 2 * 1500.5 * 0.9, 3 * 800 * 0.75 y 1 * 100 * 1.
SUBTOTALES = [2700.9, 1800.0, 100.0]


def _recalcular(datos: bytes, carpeta: Path) -> Workbook:
    """Convierte el libro con LibreOffice headless, que calcula y guarda los resultados."""
    assert SOFFICE is not None
    entrada = carpeta / "entrada.xlsx"
    salida = carpeta / "salida"
    entrada.write_bytes(datos)
    # Perfil aislado para no interferir con una sesión de LibreOffice abierta.
    subprocess.run(  # noqa: S603 - ejecutable local y argumentos fijos, sin shell.
        [
            SOFFICE,
            "--headless",
            "--norestore",
            f"-env:UserInstallation={(carpeta / 'perfil').as_uri()}",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(salida),
            str(entrada),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    return load_workbook(salida / "entrada.xlsx", data_only=True)


def test_releer_con_openpyxl_conserva_tipos_formatos_y_formulas(tmp_path: Path) -> None:
    libro = load_workbook(
        BytesIO(renderizar_xlsx(PLANILLA, Configuracion(carpeta_trabajo=tmp_path)))
    )
    ventas = libro["Ventas"]
    assert [celda.data_type for celda in ventas[2]] == ["s", "n", "n", "n", "f", "d"]
    assert ventas["B3"].value == 3
    assert ventas["C2"].value == pytest.approx(1500.5)
    assert ventas["D2"].value == pytest.approx(0.1)
    assert ventas["F3"].value == datetime(2026, 1, 16)
    assert ventas["A4"].value == "=SUM(A1)"
    assert ventas["A4"].data_type == "s"
    assert [celda.number_format for celda in ventas[2]] == [
        "General",
        "#,##0",
        '"$" #,##0.00',
        "0.00%",
        '"$" #,##0.00',
        "dd/mm/yyyy",
    ]
    assert ventas["E2"].value == "=B2*C2*(1-D2)"
    assert ventas["E5"].value == "=SUBTOTAL(109,E2:E4)"
    assert ventas.tables["Ventas2026"].ref == "A1:F4"
    resumen = libro["Resumen general"]
    assert resumen["B2"].value == "=SUM(Ventas2026[Subtotal])"
    assert resumen.freeze_panes == "A2"


@pytest.mark.skipif(SOFFICE is None, reason="LibreOffice no está instalado (opcional en CI).")
def test_libreoffice_calcula_los_valores_esperados(tmp_path: Path) -> None:
    datos = renderizar_xlsx(PLANILLA, Configuracion(carpeta_trabajo=tmp_path))
    libro = _recalcular(datos, tmp_path)
    ventas = libro["Ventas"]
    assert [ventas[f"E{fila}"].value for fila in (2, 3, 4)] == pytest.approx(SUBTOTALES)
    assert ventas["B5"].value == 6
    assert ventas["E5"].value == pytest.approx(sum(SUBTOTALES))
    assert ventas["A4"].value == "=SUM(A1)"
    resumen = libro["Resumen general"]
    assert resumen["B2"].value == pytest.approx(sum(SUBTOTALES))
    assert resumen["B3"].value == 6
    assert resumen["B4"].value == pytest.approx(800.17)
    assert resumen["B5"].value == "alto"


@pytest.mark.skipif(SOFFICE is None, reason="LibreOffice no está instalado (opcional en CI).")
def test_libreoffice_recalcula_totales_despues_de_editar(tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path)
    almacen = Almacen(tmp_path)
    guardado = almacen.guardar_subida("ventas.xlsx", renderizar_xlsx(PLANILLA, config))
    operaciones = TypeAdapter(list[OperacionXLSX]).validate_python(
        [
            {
                "tipo": "agregar_filas",
                "hoja": "Ventas",
                "filas": [["Mate", 4, "250", "0", {"formula": "=B5*C5*(1-D5)"}, "2026-01-17"]],
            }
        ]
    )
    datos = editar_libro(cargar_libro(guardado.id, almacen, config), operaciones, config=config)
    libro = _recalcular(datos, tmp_path)
    ventas = libro["Ventas"]
    assert ventas["E5"].value == pytest.approx(1000)
    assert ventas["A6"].value == "Total"
    assert ventas["B6"].value == 10
    assert ventas["E6"].value == pytest.approx(sum(SUBTOTALES) + 1000)
    assert libro["Resumen general"]["B2"].value == pytest.approx(sum(SUBTOTALES) + 1000)
