"""Pruebas del renderizador PDF."""

from io import BytesIO

import pytest
from pydantic import ValidationError
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import stringWidth

from convertitodo_mcp.blocks import Documento
from convertitodo_mcp.render.fuentes import MONO, registrar_fuentes
from convertitodo_mcp.render.pdf import OpcionesPDF, _ajustar_codigo, renderizar_pdf


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


def test_tabla_larga_repite_encabezado() -> None:
    documento = Documento.model_validate(
        {
            "bloques": [
                {
                    "tipo": "tabla",
                    "encabezado": ["Encabezado único", "Detalle"],
                    "filas": [[f"Fila {indice}", "Contenido"] for indice in range(80)],
                }
            ]
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(documento.bloques)))
    assert len(pdf.pages) > 1
    textos = [pagina.extract_text() for pagina in pdf.pages]
    assert all("Encabezado único" in texto for texto in textos)
    assert "Fila 79" in textos[-1]


def test_opciones_pagina_metadata_y_numeracion() -> None:
    bloques = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "parrafo", "texto": "Primera"},
                {"tipo": "salto_pagina"},
                {"tipo": "parrafo", "texto": "Segunda"},
            ]
        }
    ).bloques
    opciones = OpcionesPDF.model_validate(
        {
            "tamano": "Carta",
            "orientacion": "horizontal",
            "titulo": "Informe",
            "autor": "Autora",
            "numerar_paginas": True,
            "margenes": {"superior": 30, "inferior": 30, "izquierdo": 35, "derecho": 35},
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(bloques, opciones)))
    assert pdf.metadata is not None
    assert pdf.metadata.title == "Informe"
    assert pdf.metadata.author == "Autora"
    assert float(pdf.pages[0].mediabox.width) == pytest.approx(792)
    assert float(pdf.pages[0].mediabox.height) == pytest.approx(612)
    for numero, pagina in enumerate(pdf.pages, start=1):
        assert str(numero) in pagina.extract_text().splitlines()


@pytest.mark.parametrize("valor", [float("nan"), float("inf"), -1, 500])
def test_margenes_invalidos(valor: float) -> None:
    with pytest.raises(ValidationError):
        OpcionesPDF.model_validate({"margenes": {"izquierdo": valor}})


def test_codigo_largo_se_ajusta_sin_perder_caracteres() -> None:
    registrar_fuentes()
    original = "  " + "x" * 200 + " fin"
    ajustado = _ajustar_codigo(original, 100)
    assert ajustado.replace("\n", "") == original
    assert all(stringWidth(linea, MONO, 9) <= 100 for linea in ajustado.split("\n"))


def test_numeracion_requiere_margen_inferior() -> None:
    with pytest.raises(ValidationError, match="margen inferior de al menos 10 mm"):
        OpcionesPDF.model_validate({"numerar_paginas": True, "margenes": {"inferior": 9}})
