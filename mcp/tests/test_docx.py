"""Pruebas del renderizado DOCX."""

from io import BytesIO

from docx import Document
from docx.shared import Pt

from convertitodo_mcp.blocks import Documento
from convertitodo_mcp.render.docx import agregar_bloques, renderizar_docx


def test_bloques_basicos_editables() -> None:
    bloques = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "titulo", "nivel": 1, "texto": "Primero"},
                {"tipo": "titulo", "nivel": 6, "texto": "Profundo"},
                {"tipo": "parrafo", "texto": "Texto <literal>"},
                {
                    "tipo": "lista",
                    "items": [
                        {"texto": "Viñeta", "sublista": {"ordenada": True, "items": ["Uno"]}}
                    ],
                },
                {"tipo": "codigo", "texto": "a < b\nsegunda línea"},
                {"tipo": "cita", "texto": "Cita"},
                {"tipo": "salto_pagina"},
            ]
        }
    ).bloques
    documento = Document(BytesIO(renderizar_docx(bloques, titulo="Documento")))
    parrafos = documento.paragraphs
    assert documento.core_properties.title == "Documento"
    assert [p.style.name for p in parrafos[:6]] == [
        "Title",
        "Heading 1",
        "Heading 3",
        "Normal",
        "List Bullet",
        "List Number",
    ]
    assert parrafos[3].text == "Texto <literal>"
    assert parrafos[5].paragraph_format.left_indent == Pt(72)
    assert parrafos[6].text == "a < b\nsegunda línea"
    assert parrafos[6].runs[0].font.name == "Noto Sans Mono"
    assert parrafos[7].style.name == "Quote"
    assert 'w:type="page"' in parrafos[8]._p.xml


def test_agregar_bloques_conserva_contenido_existente() -> None:
    documento = Document()
    documento.add_paragraph("Existente")
    bloques = Documento.model_validate({"bloques": [{"tipo": "parrafo", "texto": "Nuevo"}]}).bloques
    agregar_bloques(documento, bloques)
    assert [p.text for p in documento.paragraphs] == ["Existente", "Nuevo"]


def test_tablas_editables_con_encabezado_repetido_y_bordes() -> None:
    bloques = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "tabla", "encabezado": ["A", "B"], "filas": [["<uno>", "dos"]]},
                {"tipo": "tabla", "filas": [["Sin encabezado"]]},
                {"tipo": "tabla", "filas": []},
            ]
        }
    ).bloques
    documento = Document(BytesIO(renderizar_docx(bloques)))
    assert len(documento.tables) == 2
    tabla = documento.tables[0]
    assert [[celda.text for celda in fila.cells] for fila in tabla.rows] == [
        ["A", "B"],
        ["<uno>", "dos"],
    ]
    assert all(celda.paragraphs[0].runs[0].bold for celda in tabla.rows[0].cells)
    assert "w:tblHeader" in tabla.rows[0]._tr.xml
    assert "w:tblHeader" not in tabla.rows[1]._tr.xml
    assert "w:tblBorders" in tabla._tbl.xml
    assert "w:insideH" in tabla._tbl.xml
    assert "w:insideV" in tabla._tbl.xml
    assert "w:tblHeader" not in documento.tables[1].rows[0]._tr.xml
