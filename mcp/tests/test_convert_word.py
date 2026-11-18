"""Pruebas de las conversiones desde Word: bloques, PDF y Excel."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from docx import Document
from docx.enum.text import WD_BREAK
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from openpyxl import load_workbook
from pypdf import PdfReader

from convertitodo_mcp.blocks import Imagen, Lista, Parrafo, SaltoPagina, Tabla, Titulo, texto_plano
from convertitodo_mcp.convert.word import docx_a_bloques, docx_a_pdf, docx_a_xlsx, tablas_de_docx
from convertitodo_mcp.errores import ErrorArgumento, ErrorConvertiTodo, ErrorLimiteExcedido
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

Fixture = Callable[[str], bytes]


@pytest.fixture
def config(tmp_path: Path) -> Configuracion:
    return Configuracion(carpeta_trabajo=tmp_path)


def _docx_rico(imagen: bytes) -> bytes:
    documento = Document()
    documento.add_heading("Informe", 1)
    parrafo = documento.add_paragraph("Texto ")
    parrafo.add_run("fuerte").bold = True
    parrafo.add_run(" suave").italic = True
    ident = documento.part.relate_to("https://ejemplo.com", RT.HYPERLINK, is_external=True)
    parrafo._p.append(
        parse_xml(
            f'<w:hyperlink {nsdecls("w", "r")} r:id="{ident}"><w:r><w:t>sitio</w:t></w:r>'
            "</w:hyperlink>"
        )
    )
    documento.add_paragraph("uno", style="List Bullet")
    documento.add_paragraph("dos", style="List Bullet 2")
    documento.add_paragraph("tres", style="List Bullet")
    tabla = documento.add_table(rows=2, cols=3)
    for columna, texto in enumerate(("A", "B", "C")):
        tabla.cell(0, columna).text = texto
    tabla.cell(1, 0).merge(tabla.cell(1, 1)).text = "unidas"
    tabla.cell(1, 2).text = "9"
    documento.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    documento.add_paragraph().add_run().add_picture(BytesIO(imagen))
    documento.add_paragraph("final")
    salida = BytesIO()
    documento.save(salida)
    return salida.getvalue()


def test_docx_a_bloques_conserva_orden_y_tipos(
    fixture_bytes: Fixture, config: Configuracion
) -> None:
    bloques = docx_a_bloques(fixture_bytes("sample.docx"), config)
    assert [b.tipo for b in bloques] == [
        "titulo",
        "titulo",
        "parrafo",
        "titulo",
        "lista",
        "titulo",
        "tabla",
    ]
    titulo = bloques[0]
    assert isinstance(titulo, Titulo)
    assert texto_plano(titulo.texto) == "ConvertiTodo — Documento de prueba"
    lista = bloques[4]
    assert isinstance(lista, Lista)
    assert not lista.ordenada
    assert len(lista.items) == 4
    tabla = bloques[6]
    assert isinstance(tabla, Tabla)
    assert tabla.encabezado is not None
    assert [texto_plano(c) for c in tabla.encabezado] == ["Origen", "Destino", "Fidelidad"]
    assert len(tabla.filas) == 3


def test_docx_a_pdf_contiene_titulo_parrafo_y_celda(
    fixture_bytes: Fixture, config: Configuracion
) -> None:
    pdf = docx_a_pdf(fixture_bytes("sample.docx"), config, titulo="Prueba")
    texto = "".join(p.extract_text() for p in PdfReader(BytesIO(pdf)).pages)
    assert "Introducción" in texto
    assert "fixture para testear" in texto
    assert "Solo tablas" in texto


def test_docx_rico_refleja_formato_lista_tabla_salto(
    fixture_bytes: Fixture, config: Configuracion
) -> None:
    bloques = docx_a_bloques(_docx_rico(fixture_bytes("sample.png")), config)
    assert [b.tipo for b in bloques] == [
        "titulo",
        "parrafo",
        "lista",
        "tabla",
        "salto_pagina",
        "parrafo",
    ]
    parrafo = bloques[1]
    assert isinstance(parrafo, Parrafo)
    assert [t.negrita for t in parrafo.texto] == [False, True, False, False]
    assert parrafo.texto[2].italica
    assert parrafo.texto[3].enlace == "https://ejemplo.com"
    lista = bloques[2]
    assert isinstance(lista, Lista)
    assert len(lista.items) == 2
    assert lista.items[0].sublista is not None
    assert texto_plano(lista.items[0].sublista.items[0].texto) == "dos"
    tabla = bloques[3]
    assert isinstance(tabla, Tabla)
    assert tabla.filas and [texto_plano(c) for c in tabla.filas[0]] == ["unidas", "", "9"]
    assert isinstance(bloques[4], SaltoPagina)


def test_imagen_en_linea_solo_con_almacen(
    fixture_bytes: Fixture, config: Configuracion, tmp_path: Path
) -> None:
    datos = _docx_rico(fixture_bytes("sample.png"))
    almacen = Almacen(tmp_path / "almacen")
    bloques = docx_a_bloques(datos, config, almacen=almacen)
    imagenes = [b for b in bloques if isinstance(b, Imagen)]
    assert len(imagenes) == 1
    assert almacen.leer(imagenes[0].archivo).startswith(b"\x89PNG")
    assert PdfReader(BytesIO(docx_a_pdf(datos, config, almacen=almacen))).pages
    assert not any(isinstance(b, Imagen) for b in docx_a_bloques(datos, config))


def test_docx_a_xlsx_una_hoja_por_tabla(config: Configuracion) -> None:
    documento = Document()
    for nombre, valor in (("Producto", "1.5"), ("Item", "2")):
        tabla = documento.add_table(rows=2, cols=2)
        tabla.cell(0, 0).text = nombre
        tabla.cell(0, 1).text = "Precio"
        tabla.cell(1, 0).text = "Manzana"
        tabla.cell(1, 1).text = valor
    salida = BytesIO()
    documento.save(salida)
    libro = load_workbook(BytesIO(docx_a_xlsx(salida.getvalue(), config)))
    assert libro.sheetnames == ["Tabla1", "Tabla2"]
    hoja = libro["Tabla1"]
    assert [c.value for c in hoja[1]] == ["Producto", "Precio"]
    assert hoja["A2"].value == "Manzana"
    assert hoja["B2"].value == 1.5


def test_docx_a_xlsx_con_fixture_table(fixture_bytes: Fixture, config: Configuracion) -> None:
    libro = load_workbook(BytesIO(docx_a_xlsx(fixture_bytes("table.docx"), config)))
    assert libro.sheetnames == ["Tabla1"]
    hoja = libro["Tabla1"]
    assert [c.value for c in hoja[1]] == ["Producto", "Precio"]
    assert [c.value for c in hoja[2]] == ["Manzana", 1.5]


def test_tablas_de_docx(fixture_bytes: Fixture, config: Configuracion) -> None:
    assert tablas_de_docx(fixture_bytes("table.docx"), config) == [
        [["Producto", "Precio"], ["Manzana", "1.50"]]
    ]


def test_docx_a_xlsx_sin_tablas_se_rechaza(fixture_bytes: Fixture, config: Configuracion) -> None:
    with pytest.raises(ErrorArgumento, match="no tiene tablas"):
        docx_a_xlsx(fixture_bytes("notables.docx"), config)


@pytest.mark.parametrize("nombre", ["corrupt.pdf", "text.pdf"])
def test_entrada_que_no_es_docx_se_rechaza(
    nombre: str, fixture_bytes: Fixture, config: Configuracion
) -> None:
    with pytest.raises(ErrorConvertiTodo):
        docx_a_bloques(fixture_bytes(nombre), config)


def test_bytes_vacios_se_rechazan(config: Configuracion) -> None:
    with pytest.raises(ErrorConvertiTodo):
        docx_a_pdf(b"", config)


def test_documento_sin_contenido_no_genera_pdf(config: Configuracion) -> None:
    salida = BytesIO()
    Document().save(salida)
    with pytest.raises(ErrorArgumento, match="no tiene contenido"):
        docx_a_pdf(salida.getvalue(), config)


def test_tope_de_bloques(fixture_bytes: Fixture, tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_bloques=2)
    with pytest.raises(ErrorLimiteExcedido):
        docx_a_bloques(fixture_bytes("sample.docx"), config)
