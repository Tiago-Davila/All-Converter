"""Pruebas del renderizador PDF."""

from io import BytesIO

from pypdf import PdfReader

from convertitodo_mcp.blocks import Documento
from convertitodo_mcp.render.pdf import renderizar_pdf


def test_renderizar_bloques_basicos() -> None:
    documento = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "titulo", "texto": "Título & prueba"},
                {"tipo": "parrafo", "texto": [{"texto": "<etiqueta>", "negrita": True}]},
                {"tipo": "lista", "items": ["Primero", "Segundo"]},
                {"tipo": "tabla", "encabezado": ["Columna"], "filas": [["Celda"]]},
                {"tipo": "codigo", "texto": "a < b"},
                {"tipo": "salto_pagina"},
                {"tipo": "cita", "texto": "Cita"},
            ]
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(documento.bloques)))
    assert len(pdf.pages) == 2
    texto = "\n".join(pagina.extract_text() for pagina in pdf.pages)
    for esperado in ("Título & prueba", "<etiqueta>", "Primero", "Celda", "a < b", "Cita"):
        assert esperado in texto
