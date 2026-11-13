"""Conversión entre planillas XLSX, CSV y JSON, y de planilla a PDF."""

import json
from collections.abc import Callable
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader

from convertitodo_mcp.convert.planillas import (
    TablaLeida,
    convertir_planilla,
    leer_tablas,
    tablas_a_csv,
    tablas_a_json,
    tablas_a_xlsx,
)
from convertitodo_mcp.errores import ErrorArgumento, ErrorConvertiTodo, ErrorLimiteExcedido
from convertitodo_mcp.server.config import Configuracion

Fixture = Callable[[str], bytes]


@pytest.fixture
def config(tmp_path: Path) -> Configuracion:
    return Configuracion(carpeta_trabajo=tmp_path)


def _texto_pdf(datos: bytes) -> str:
    return "\n".join(pagina.extract_text() for pagina in PdfReader(BytesIO(datos)).pages)


def _filas_xlsx(datos: bytes, hoja: str | None = None) -> list[list[object]]:
    libro = load_workbook(BytesIO(datos))
    hoja_xlsx = libro[hoja] if hoja else libro.active
    assert hoja_xlsx is not None
    return [[celda.value for celda in fila] for fila in hoja_xlsx.iter_rows()]


def test_xlsx_a_csv_con_varias_hojas_da_un_archivo_por_hoja(
    config: Configuracion, fixture_bytes: Fixture
) -> None:
    salidas = convertir_planilla(fixture_bytes("multisheet.xlsx"), "xlsx", "csv", config)

    assert [s.nombre for s in salidas] == ["planilla-Ventas.csv", "planilla-Totales.csv"]
    assert salidas[0].datos == b"producto,precio\ncafe,1200\nte,900\n"
    assert salidas[1].datos == b"mes,total\nenero,2100\nfebrero,1800\n"


def test_xlsx_a_csv_con_una_hoja_usa_el_nombre_base(config: Configuracion) -> None:
    libro = Workbook()
    libro.active.append(["a", "b"])
    libro.active.append([1, None])
    entrada = BytesIO()
    libro.save(entrada)

    salidas = convertir_planilla(entrada.getvalue(), "xlsx", "csv", config, nombre_base="datos")

    assert [(s.nombre, s.datos) for s in salidas] == [("datos.csv", b"a,b\n1,\n")]


def test_xlsx_a_json_conserva_tipos_y_hojas(config: Configuracion, fixture_bytes: Fixture) -> None:
    salida = convertir_planilla(fixture_bytes("sample.xlsx"), "xlsx", "json", config)[0]
    contenido = json.loads(salida.datos)

    assert salida.nombre == "planilla.json"
    assert list(contenido) == ["Libros", "Clientes"]
    assert contenido["Libros"][0] == {
        "ISBN": "978-987-1",
        "Titulo": "El Aleph",
        "Autor": "Borges",
        "Paginas": 224,
        "Categoria": "adultos",
    }
    assert contenido["Clientes"][1]["DNI"] == 28999333


def test_csv_a_xlsx_deja_numeros_como_numeros(
    config: Configuracion, fixture_bytes: Fixture
) -> None:
    salida = convertir_planilla(fixture_bytes("sample.csv"), "csv", "xlsx", config)[0]
    filas = _filas_xlsx(salida.datos)

    assert filas[0] == ["id", "producto", "precio", "categoría"]
    assert filas[1] == [1, "Café molido", 3200, "almacén"]
    assert all(isinstance(fila[0], int) and isinstance(fila[2], int) for fila in filas[1:])
    assert load_workbook(BytesIO(salida.datos)).active["C2"].number_format == "0"


def test_csv_a_json_tipa_los_numeros(config: Configuracion, fixture_bytes: Fixture) -> None:
    contenido = json.loads(
        convertir_planilla(fixture_bytes("sample.csv"), "csv", "json", config)[0].datos
    )

    assert contenido[0] == {
        "id": 1,
        "producto": "Café molido",
        "precio": 3200,
        "categoría": "almacén",
    }
    assert len(contenido) == 4


def test_json_a_xlsx_y_a_csv(config: Configuracion, fixture_bytes: Fixture) -> None:
    xlsx = convertir_planilla(fixture_bytes("sample.json"), "json", "xlsx", config)[0]
    csv = convertir_planilla(fixture_bytes("sample.json"), "json", "csv", config)[0]

    assert _filas_xlsx(xlsx.datos)[1] == ["Ada", "ingeniera", 1843]
    assert csv.datos.decode() == (
        "nombre,rol,anio\nAda,ingeniera,1843\nGrace,almirante,1952\nHedy,inventora,1942\n"
    )


def test_ida_y_vuelta_csv_xlsx_csv_conserva_los_datos(
    config: Configuracion, fixture_bytes: Fixture
) -> None:
    original = fixture_bytes("sample.csv")
    xlsx = convertir_planilla(original, "csv", "xlsx", config)[0].datos

    assert convertir_planilla(xlsx, "xlsx", "csv", config)[0].datos == original


def test_json_con_hojas_y_columnas_variables(config: Configuracion) -> None:
    datos = json.dumps(
        {"A": [{"x": 1}, {"x": 2, "y": "z"}], "B": [{"k": True, "f": None}]}
    ).encode()
    tablas = leer_tablas(datos, "json", config)

    assert [t.nombre for t in tablas] == ["A", "B"]
    assert tablas[0].encabezado == ["x", "y"]
    assert tablas[0].filas == [[1, None], [2, "z"]]
    assert tablas[1].filas == [[True, None]]


def test_encabezados_vacios_y_repetidos_se_desambiguan(config: Configuracion) -> None:
    tabla = TablaLeida("H", ["nombre", "", "Nombre"], [["a", "b", "c"]])

    contenido = json.loads(tablas_a_json([tabla]))
    assert list(contenido[0]) == ["nombre", "columna_2", "Nombre_2"]
    assert _filas_xlsx(tablas_a_xlsx([tabla], config))[0] == ["nombre", "columna_2", "Nombre_2"]


def test_fechas_en_iso_8601(config: Configuracion) -> None:
    tabla = TablaLeida(
        "H", ["d", "t"], [[date(2024, 3, 5), datetime(2024, 3, 5, 10, 30)], [None, None]]
    )

    assert json.loads(tablas_a_json([tabla])) == [
        {"d": "2024-03-05", "t": "2024-03-05T10:30:00"},
        {"d": None, "t": None},
    ]
    assert tablas_a_csv([tabla])[0].datos == b"d,t\n2024-03-05,2024-03-05T10:30:00\n,\n"
    fechas = _filas_xlsx(tablas_a_xlsx([tabla], config))
    assert fechas[1][0] == datetime(2024, 3, 5)


def test_xlsx_con_fechas_y_formula_sin_valor_cacheado(config: Configuracion) -> None:
    libro = Workbook()
    hoja = libro.active
    assert hoja is not None
    hoja.append(["fecha", "calculo"])
    hoja.append([date(2024, 1, 31), "=1+1"])
    entrada = BytesIO()
    libro.save(entrada)

    tabla = leer_tablas(entrada.getvalue(), "xlsx", config)[0]

    # openpyxl no calcula fórmulas: sin valor cacheado la celda queda vacía.
    assert tabla.filas == [[date(2024, 1, 31), None]]


def test_csv_con_punto_y_coma_y_bom(config: Configuracion) -> None:
    datos = "﻿nombre;precio\nCafé;3,5\nTé;2\n".encode()

    tabla = leer_tablas(datos, "csv", config)[0]

    assert tabla.encabezado == ["nombre", "precio"]
    assert tabla.filas == [["Café", "3,5"], ["Té", "2"]]
    assert json.loads(tablas_a_json([tabla])) == [
        {"nombre": "Café", "precio": 3.5},
        {"nombre": "Té", "precio": 2},
    ]


def test_csv_con_tabulacion_y_latin1(config: Configuracion) -> None:
    datos = "ciudad\tpaís\nMálaga\tEspaña\n".encode("latin-1")

    tabla = leer_tablas(datos, "csv", config)[0]

    assert tabla.encabezado == ["ciudad", "país"]
    assert tabla.filas == [["Málaga", "España"]]


def test_csv_con_codigos_con_ceros_se_conserva_como_texto(config: Configuracion) -> None:
    salida = convertir_planilla(b"codigo,n\n007,1\n010,2\n", "csv", "xlsx", config)[0]

    assert _filas_xlsx(salida.datos) == [["codigo", "n"], ["007", 1], ["010", 2]]


@pytest.mark.parametrize(
    "contenido",
    [
        '[{"a": {"b": 1}}]',
        '[{"a": [1, 2]}]',
        "[1, 2, 3]",
        "{}",
        "[]",
        '{"hoja": 5}',
        '"texto"',
        "[{]",
        '[{"a": NaN}]',
    ],
)
def test_json_no_tabular_se_rechaza_con_mensaje_util(config: Configuracion, contenido: str) -> None:
    with pytest.raises(ErrorArgumento) as error:
        leer_tablas(contenido.encode(), "json", config)

    assert error.value.que_fallo
    assert error.value.como_corregir
    if contenido != "[{]" and "NaN" not in contenido:
        assert "no es tabular" in error.value.que_fallo
        assert '"producto"' in error.value.como_corregir


def test_csv_vacio_y_fila_con_columnas_de_mas(config: Configuracion) -> None:
    with pytest.raises(ErrorArgumento, match="vacío"):
        leer_tablas(b"\n\n", "csv", config)
    with pytest.raises(ErrorArgumento, match="fila 1"):
        leer_tablas(b"a,b\n1,2,3\n", "csv", config)


def test_inyeccion_en_csv_de_entrada_queda_como_texto_en_xlsx(config: Configuracion) -> None:
    salida = convertir_planilla(b"nombre,nota\nAna,=CMD()\nLuis,@x\n", "csv", "xlsx", config)[0]
    libro = load_workbook(BytesIO(salida.datos))
    celda = libro.active["B2"]

    assert celda.value == "=CMD()"
    assert celda.data_type == "s"
    assert celda.quotePrefix is True


def test_inyeccion_en_xlsx_se_neutraliza_al_pasar_a_csv(config: Configuracion) -> None:
    tabla = TablaLeida("H", ["t", "n"], [["=1+1", -5], ["+1", -2.5], ["-x", 7], ["@a", None]])
    xlsx = tablas_a_xlsx([tabla], config)

    # El texto "=1+1" sigue siendo texto en la planilla.
    assert _filas_xlsx(xlsx)[1][0] == "=1+1"
    salida = convertir_planilla(xlsx, "xlsx", "csv", config)[0].datos.decode()
    assert salida == "t,n\n'=1+1,-5\n'+1,-2.5\n'-x,7\n'@a,\n"


@pytest.mark.parametrize("origen", ["multisheet.xlsx", "sample.csv", "sample.json"])
def test_planilla_a_pdf(config: Configuracion, fixture_bytes: Fixture, origen: str) -> None:
    formato = origen.rsplit(".", 1)[1]
    salida = convertir_planilla(fixture_bytes(origen), formato, "pdf", config)[0]  # type: ignore[arg-type]
    texto = _texto_pdf(salida.datos)

    assert salida.nombre == "planilla.pdf"
    esperado = {
        "multisheet.xlsx": ("producto", "precio", "cafe", "Totales"),
        "sample.csv": ("producto", "categoría", "Yerba mate", "panadería"),
        "sample.json": ("nombre", "rol", "Grace", "inventora"),
    }[origen]
    for fragmento in esperado:
        assert fragmento in texto


def test_pdf_pagina_automaticamente_y_repite_encabezado(config: Configuracion) -> None:
    filas = "".join(f"{i},valor{i}\n" for i in range(150))
    salida = convertir_planilla(f"id,texto\n{filas}".encode(), "csv", "pdf", config)[0]
    paginas = PdfReader(BytesIO(salida.datos)).pages

    assert len(paginas) > 1
    assert "valor149" in paginas[-1].extract_text()
    assert "texto" in paginas[1].extract_text()


def test_pdf_horizontal_con_muchas_columnas(config: Configuracion) -> None:
    encabezado = ",".join(f"c{i}" for i in range(10))
    salida = convertir_planilla(f"{encabezado}\n{encabezado}\n".encode(), "csv", "pdf", config)[0]
    pagina = PdfReader(BytesIO(salida.datos)).pages[0]

    assert pagina.mediabox.width > pagina.mediabox.height


def test_tope_de_filas(tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_filas=3)

    with pytest.raises(ErrorLimiteExcedido):
        leer_tablas(b"a\n1\n2\n3\n4\n", "csv", config)
    with pytest.raises(ErrorLimiteExcedido):
        leer_tablas(b'[{"a":1},{"a":2},{"a":3},{"a":4}]', "json", config)
    assert len(leer_tablas(b"a\n1\n2\n3\n", "csv", config)[0].filas) == 3


def test_tope_de_filas_en_xlsx(tmp_path: Path, fixture_bytes: Fixture) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_filas=3)

    # sample.xlsx tiene 5 + 3 filas de datos en total.
    with pytest.raises(ErrorLimiteExcedido):
        leer_tablas(fixture_bytes("sample.xlsx"), "xlsx", config)


def test_tope_de_columnas(config: Configuracion) -> None:
    ancho = ",".join(f"c{i}" for i in range(600))

    with pytest.raises(ErrorLimiteExcedido, match="columnas"):
        leer_tablas(f"{ancho}\n".encode(), "csv", config)


def test_xlsx_corrupto_da_error_de_dominio(config: Configuracion, fixture_bytes: Fixture) -> None:
    for basura in (fixture_bytes("corrupt.pdf"), b"\x00\x01\x02 no es un zip", b""):
        with pytest.raises(ErrorConvertiTodo):
            convertir_planilla(basura, "xlsx", "csv", config)


def test_origen_igual_a_destino(config: Configuracion, fixture_bytes: Fixture) -> None:
    with pytest.raises(ErrorArgumento, match="origen y el destino"):
        convertir_planilla(fixture_bytes("sample.csv"), "csv", "csv", config)


def test_nombres_de_hoja_largos_o_invalidos_se_sanean(config: Configuracion) -> None:
    tablas = [
        TablaLeida("a/b:c" + "x" * 40, ["h"], [["1"]]),
        TablaLeida("A/B:C" + "x" * 40, ["h"], [["2"]]),
        TablaLeida("", ["h"], [["3"]]),
    ]
    libro = load_workbook(BytesIO(tablas_a_xlsx(tablas, config)))

    assert len({n.lower() for n in libro.sheetnames}) == 3
    assert all(len(n) <= 31 for n in libro.sheetnames)
    nombres = [s.nombre for s in tablas_a_csv(tablas, nombre_base="x")]
    assert len(set(nombres)) == 3
