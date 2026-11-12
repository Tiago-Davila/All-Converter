"""Edición de copias de XLSX: agregar filas, agregar hojas y escribir celdas."""

from collections.abc import Callable
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet
from pydantic import TypeAdapter

from convertitodo_mcp.blocks.planilla import Planilla
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado, ErrorLimiteExcedido
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.render.xlsx_edit import OperacionXLSX, cargar_libro, editar_libro
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

OPERACIONES = TypeAdapter(list[OperacionXLSX])

PLANILLA = {
    "hojas": [
        {
            "nombre": "Ventas",
            "columnas": [
                {"nombre": "Producto"},
                {"nombre": "Precio", "tipo": "moneda"},
                {"nombre": "Fecha", "tipo": "fecha"},
            ],
            "filas": [["Café", 1500, "2026-01-01"], ["Té", 800, "2026-01-02"]],
            "fila_totales": True,
            "formato_condicional": [{"columna": "Precio", "operador": "mayor", "valor": 1000}],
        },
        {
            "nombre": "Tabla",
            "columnas": [{"nombre": "Clave"}, {"nombre": "Valor", "tipo": "numero"}],
            "filas": [["a", 1]],
            "tabla": "Datos",
        },
    ]
}


def _editar(
    tmp_path: Path, operaciones: list[dict[str, object]], datos: bytes | None = None
) -> dict[str, Worksheet]:
    config = Configuracion(carpeta_trabajo=tmp_path)
    almacen = Almacen(tmp_path)
    if datos is None:
        datos = renderizar_xlsx(Planilla.model_validate(PLANILLA), config)
    guardado = almacen.guardar_subida("libro.xlsx", datos)
    resultado = editar_libro(
        cargar_libro(guardado.id, almacen, config),
        OPERACIONES.validate_python(operaciones),
        config=config,
    )
    assert almacen.leer(guardado.id) == datos
    libro = load_workbook(BytesIO(resultado))
    return {hoja.title: hoja for hoja in libro.worksheets}


def test_agregar_filas_mueve_totales_y_extiende_rangos(tmp_path: Path) -> None:
    hojas = _editar(
        tmp_path,
        [
            {
                "tipo": "agregar_filas",
                "hoja": "ventas",
                "filas": [["Mate", "1.200,5", "03/01/2026"], ["=cmd", None, "2026-01-04T10:30"]],
            },
            {"tipo": "agregar_filas", "hoja": "Tabla", "filas": [["b", "2,5"]]},
        ],
    )
    ventas = hojas["Ventas"]
    assert ventas["A4"].value == "Mate"
    assert ventas["B4"].value == pytest.approx(1200.5)
    assert ventas["B4"].number_format == '"$" #,##0.00'
    assert ventas["C4"].value == datetime(2026, 1, 3)
    assert ventas["C4"].number_format == "dd/mm/yyyy"
    assert ventas["C5"].number_format == "dd/mm/yyyy hh:mm"
    assert ventas["A5"].data_type == "s"
    assert ventas["A5"].quotePrefix is True
    assert [celda.value for celda in ventas[6]] == [
        "Total",
        "=SUBTOTAL(109,B2:B5)",
        None,
    ]
    assert ventas["A6"].font.bold is True
    assert ventas["A4"].font.bold is False
    assert ventas.auto_filter.ref == "A1:C5"
    assert [str(rango.sqref) for rango in ventas.conditional_formatting] == ["B2:B5"]
    tabla = hojas["Tabla"]
    assert tabla.tables["Datos"].ref == "A1:B3"
    assert tabla["B3"].value == pytest.approx(2.5)


def test_escribir_celdas_infiere_tipo_y_valida(tmp_path: Path) -> None:
    hojas = _editar(
        tmp_path,
        [
            {
                "tipo": "escribir_celdas",
                "hoja": "Ventas",
                "celdas": [
                    {"celda": "B2", "valor": "2.000,75"},
                    {"celda": "a3", "valor": "=HYPERLINK(1)"},
                    {"celda": "E2", "valor": {"formula": "=SUM(Tabla!B2:B2)+SUM(Datos[Valor])"}},
                    {"celda": "C2", "valor": None},
                ],
            },
        ],
    )
    ventas = hojas["Ventas"]
    assert ventas["B2"].value == pytest.approx(2000.75)
    assert ventas["B2"].data_type == "n"
    assert ventas["A3"].data_type == "s"
    assert ventas["E2"].value == "=SUM(Tabla!B2:B2)+SUM(Datos[Valor])"
    assert ventas["C2"].value is None


def test_agregar_hoja_con_referencias_a_hojas_existentes(tmp_path: Path) -> None:
    hojas = _editar(
        tmp_path,
        [
            {
                "tipo": "agregar_hoja",
                "hoja": {
                    "nombre": "Resumen",
                    "columnas": [{"nombre": "Total", "tipo": "moneda"}],
                    "filas": [[{"formula": "=Ventas!B4+SUM(Datos[Valor])"}]],
                    "tabla": "Resumen",
                },
            }
        ],
    )
    assert list(hojas) == ["Ventas", "Tabla", "Resumen"]
    resumen = hojas["Resumen"]
    assert resumen["A2"].value == "=Ventas!B4+SUM(Datos[Valor])"
    assert resumen["A1"].font.bold is True
    assert resumen.tables["Resumen"].ref == "A1:A2"


def test_edita_fixture_real_multisheet(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    hojas = _editar(
        tmp_path,
        [{"tipo": "agregar_filas", "hoja": "Ventas", "filas": [["mate", "750"]]}],
        fixture_bytes("multisheet.xlsx"),
    )
    assert hojas["Ventas"]["B4"].value == 750
    assert hojas["Totales"]["B2"].value == 2100


@pytest.mark.parametrize(
    ("operacion", "error", "mensaje"),
    [
        (
            {"tipo": "agregar_filas", "hoja": "Falta", "filas": [["x"]]},
            ErrorArgumento,
            "Ventas, Tabla",
        ),
        (
            {"tipo": "agregar_filas", "hoja": "Ventas", "filas": [["x", "mucho", None]]},
            ErrorArgumento,
            "fila agregada 1, columna 2",
        ),
        (
            {"tipo": "escribir_celdas", "hoja": "Tabla", "celdas": [{"celda": "B1", "valor": "x"}]},
            ErrorArgumento,
            "encabezado de una tabla",
        ),
        (
            {
                "tipo": "escribir_celdas",
                "hoja": "Tabla",
                "celdas": [{"celda": "XFE1", "valor": "x"}],
            },
            ErrorArgumento,
            "fuera de los límites",
        ),
        (
            {
                "tipo": "escribir_celdas",
                "hoja": "Tabla",
                "celdas": [{"celda": "A9", "valor": {"formula": "=Otra!A1"}}],
            },
            ErrorArgumento,
            "no existe",
        ),
        (
            {
                "tipo": "agregar_hoja",
                "hoja": {"nombre": "VENTAS", "columnas": [{"nombre": "A"}]},
            },
            ErrorArgumento,
            "Ya existe una hoja",
        ),
        (
            {
                "tipo": "agregar_hoja",
                "hoja": {
                    "nombre": "Nueva",
                    "columnas": [{"nombre": "A"}],
                    "filas": [["x"]],
                    "tabla": "datos",
                },
            },
            ErrorArgumento,
            "Ya existe una tabla",
        ),
    ],
)
def test_errores_de_edicion(
    tmp_path: Path, operacion: dict[str, object], error: type[Exception], mensaje: str
) -> None:
    with pytest.raises(error, match=mensaje):
        _editar(tmp_path, [operacion])


def test_escribir_en_celda_combinada(tmp_path: Path) -> None:
    from openpyxl import Workbook

    libro = Workbook()
    hoja = libro.active
    assert isinstance(hoja, Worksheet)
    hoja.title = "Hoja"
    hoja.merge_cells("A1:B1")
    salida = BytesIO()
    libro.save(salida)
    with pytest.raises(ErrorArgumento, match="rango combinado"):
        _editar(
            tmp_path,
            [{"tipo": "escribir_celdas", "hoja": "Hoja", "celdas": [{"celda": "B1", "valor": 1}]}],
            salida.getvalue(),
        )


def test_limite_de_filas_al_agregar(tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_filas=3)
    almacen = Almacen(tmp_path)
    datos = renderizar_xlsx(Planilla.model_validate(PLANILLA), config)
    guardado = almacen.guardar_subida("libro.xlsx", datos)
    with pytest.raises(ErrorLimiteExcedido, match="La hoja 'Ventas' tiene 4 filas"):
        editar_libro(
            cargar_libro(guardado.id, almacen, config),
            OPERACIONES.validate_python(
                [{"tipo": "agregar_filas", "hoja": "Ventas", "filas": [["x", 1, None]] * 2}]
            ),
            config=config,
        )


def test_rechaza_archivos_que_no_son_excel(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path)
    almacen = Almacen(tmp_path)
    guardado = almacen.guardar_subida("falso.xlsx", fixture_bytes("sample.docx"))
    with pytest.raises(ErrorFormatoNoSoportado, match="solo edita Excel"):
        cargar_libro(guardado.id, almacen, config)
