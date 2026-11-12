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
