"""Pruebas de unión, división y rotación de PDF."""

from __future__ import annotations

from collections.abc import Callable
from io import BytesIO

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, TextStringObject

from convertitodo_mcp.convert.pdf_paginas import (
    MAX_PDFS_A_UNIR,
    contar_paginas,
    dividir_pdf,
    interpretar_rangos,
    paginas_de_rangos,
    rotar_pdf,
    unir_pdfs,
)
from convertitodo_mcp.errores import ErrorArgumento, ErrorConvertiTodo

FixtureBytes = Callable[[str], bytes]


def _leer(datos: bytes) -> PdfReader:
    return PdfReader(BytesIO(datos))


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("1-3,5,7-", [(1, 3), (5, 5), (7, 8)]),
        ("-4", [(1, 4)]),
        (" 2 - 3 , 8 ", [(2, 3), (8, 8)]),
        ("3,1,3", [(3, 3), (1, 1), (3, 3)]),
    ],
)
def test_interpretar_rangos_validos(texto: str, esperado: list[tuple[int, int]]) -> None:
    assert interpretar_rangos(texto, 8) == esperado


@pytest.mark.parametrize(
    ("texto", "fragmento"),
    [
        ("", "ningún rango"),
        ("abc", '"abc"'),
        ("-", '"-"'),
        ("1,,3", '""'),
        ("0", '"0"'),
        ("5-2", '"5-2"'),
        ("1-2-3", '"1-2-3"'),
        ("9", '"9"'),
        ("2-9", '"2-9"'),
    ],
)
def test_interpretar_rangos_invalidos(texto: str, fragmento: str) -> None:
    with pytest.raises(ErrorArgumento) as error:
        interpretar_rangos(texto, 8)
    assert fragmento in str(error.value)
    assert "1-3,5,7-" in str(error.value) or "entre 1 y 8" in str(error.value)


def test_paginas_de_rangos_aplana_sin_reordenar() -> None:
    assert paginas_de_rangos([(3, 4), (1, 1), (3, 3)]) == [3, 4, 1, 3]


def test_contar_paginas(fixture_bytes: FixtureBytes) -> None:
    assert contar_paginas(fixture_bytes("text.pdf")) == 3


def test_unir_copias(fixture_bytes: FixtureBytes) -> None:
    original = fixture_bytes("text.pdf")
    unido = _leer(unir_pdfs([original, original, original]))
    assert len(unido.pages) == 9
    assert "Table Of Content" in (unido.pages[6].extract_text() or "")


def test_unir_no_arrastra_acciones_automaticas(fixture_bytes: FixtureBytes) -> None:
    unido = _leer(unir_pdfs([fixture_bytes("text.pdf")] * 2))
    raiz = unido.root_object
    assert "/OpenAction" not in raiz
    assert "/Names" not in raiz


def test_unir_descarta_anotaciones_con_javascript(fixture_bytes: FixtureBytes) -> None:
    lector = _leer(fixture_bytes("text.pdf"))
    escritor = PdfWriter()
    pagina = escritor.add_page(lector.pages[0])
    accion = DictionaryObject(
        {
            NameObject("/S"): NameObject("/JavaScript"),
            NameObject("/JS"): TextStringObject("app.alert(1)"),
        }
    )
    anotacion = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/A"): escritor._add_object(accion),
        }
    )
    previas = list(pagina.get("/Annots", []))
    pagina[NameObject("/Annots")] = ArrayObject([*previas, escritor._add_object(anotacion)])
    buffer = BytesIO()
    escritor.write(buffer)
    unido = _leer(unir_pdfs([buffer.getvalue(), buffer.getvalue()]))
    for pag in unido.pages:
        for ref in pag.get("/Annots", []):
            accion_salida = ref.get_object().get("/A")
            assert accion_salida is None or "/JS" not in accion_salida.get_object()


def test_unir_exige_dos_y_respeta_maximo(fixture_bytes: FixtureBytes) -> None:
    original = fixture_bytes("text.pdf")
    with pytest.raises(ErrorArgumento):
        unir_pdfs([original])
    with pytest.raises(ErrorConvertiTodo):
        unir_pdfs([original] * (MAX_PDFS_A_UNIR + 1))


@pytest.mark.parametrize(
    ("fixture", "texto"), [("protected.pdf", "protegido"), ("corrupt.pdf", "abrir")]
)
def test_unir_indica_posicion_del_pdf_problematico(
    fixture_bytes: FixtureBytes, fixture: str, texto: str
) -> None:
    with pytest.raises(ErrorConvertiTodo) as error:
        unir_pdfs([fixture_bytes("text.pdf"), fixture_bytes(fixture)])
    assert "número 2" in str(error.value)
    assert texto in str(error.value)


def test_dividir_por_pagina(fixture_bytes: FixtureBytes) -> None:
    salidas = dividir_pdf(fixture_bytes("text.pdf"), nombre_base="informe")
    assert [s.nombre for s in salidas] == ["informe-p1.pdf", "informe-p2.pdf", "informe-p3.pdf"]
    assert all(len(_leer(s.datos).pages) == 1 for s in salidas)


def test_dividir_por_rangos(fixture_bytes: FixtureBytes) -> None:
    original = fixture_bytes("text.pdf")
    esperado = [(p.extract_text() or "") for p in _leer(original).pages]
    salidas = dividir_pdf(original, "1-2,3,2")
    assert [s.nombre for s in salidas] == [
        "documento-p1-2.pdf",
        "documento-p3.pdf",
        "documento-p2.pdf",
    ]
    lectores = [_leer(s.datos) for s in salidas]
    assert [len(lector.pages) for lector in lectores] == [2, 1, 1]
    assert (lectores[1].pages[0].extract_text() or "") == esperado[2]


def test_dividir_rango_fuera_de_documento(fixture_bytes: FixtureBytes) -> None:
    with pytest.raises(ErrorArgumento):
        dividir_pdf(fixture_bytes("text.pdf"), "2-4")


def test_rotar_solo_paginas_pedidas_y_acumula(fixture_bytes: FixtureBytes) -> None:
    original = fixture_bytes("text.pdf")
    una_vez = rotar_pdf(original, 90, "2")
    assert [p.rotation for p in _leer(una_vez).pages] == [0, 90, 0]
    dos_veces = rotar_pdf(una_vez, 90, "2-3")
    assert [p.rotation for p in _leer(dos_veces).pages] == [0, 180, 90]


def test_rotar_todas_por_defecto(fixture_bytes: FixtureBytes) -> None:
    rotado = _leer(rotar_pdf(fixture_bytes("text.pdf"), 270))
    assert [p.rotation for p in rotado.pages] == [270, 270, 270]


@pytest.mark.parametrize("grados", [0, 45, 360, -90])
def test_rotar_grados_invalidos(fixture_bytes: FixtureBytes, grados: int) -> None:
    with pytest.raises(ErrorArgumento):
        rotar_pdf(fixture_bytes("text.pdf"), grados)


@pytest.mark.parametrize("fixture", ["protected.pdf", "corrupt.pdf"])
def test_dividir_y_rotar_rechazan_pdf_no_utilizable(
    fixture_bytes: FixtureBytes, fixture: str
) -> None:
    datos = fixture_bytes(fixture)
    with pytest.raises(ErrorConvertiTodo):
        dividir_pdf(datos)
    with pytest.raises(ErrorConvertiTodo):
        rotar_pdf(datos, 90)
    with pytest.raises(ErrorConvertiTodo):
        contar_paginas(datos)
