"""Tests de las fuentes Noto Sans incluidas y su registro en reportlab."""

from pathlib import Path

import pytest
from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from convertitodo_mcp.render.fuentes import (
    ARCHIVOS,
    CARPETA_FUENTES,
    registrar_fuentes,
    ruta_fuente,
)

CARACTERES = "ñÑáéíóúü¿¡€"
TEXTO = "Ñandú, pingüino, canción: 10 €"


# Los cinco TTF y la licencia existen y los TTF tienen firma TrueType
def test_archivos_existen_y_son_truetype() -> None:
    assert (CARPETA_FUENTES / "OFL.txt").is_file()
    for nombre in ARCHIVOS:
        ruta = ruta_fuente(nombre)
        assert ruta.is_file()
        assert ruta.read_bytes()[:4] == b"\x00\x01\x00\x00"


# Pedir una fuente desconocida da un error claro
def test_ruta_fuente_desconocida() -> None:
    with pytest.raises(KeyError):
        ruta_fuente("Inexistente")


# Registrar dos veces no falla y deja los cinco nombres registrados
def test_registrar_fuentes_es_idempotente() -> None:
    registrar_fuentes()
    registrar_fuentes()
    registradas = set(pdfmetrics.getRegisteredFontNames())
    assert set(ARCHIVOS) <= registradas


# Cada fuente tiene glifo para ñ, tildes, ü, signos de apertura y €
@pytest.mark.parametrize("nombre", list(ARCHIVOS))
def test_cobertura_de_glifos(nombre: str) -> None:
    fuente = TTFont(nombre, str(ruta_fuente(nombre)))
    faltantes = [c for c in CARACTERES if ord(c) not in fuente.face.charToGlyph]
    assert faltantes == []


# Un PDF con NotoSans conserva el texto con ñ, tildes y € al releerlo
def test_pdf_minimo_con_unicode(tmp_path: Path) -> None:
    registrar_fuentes()
    destino = tmp_path / "prueba.pdf"
    lienzo = canvas.Canvas(str(destino))
    lienzo.setFont("NotoSans", 14)
    lienzo.drawString(72, 700, TEXTO)
    lienzo.save()
    assert destino.read_bytes().startswith(b"%PDF")
    texto = PdfReader(str(destino)).pages[0].extract_text()
    assert TEXTO in texto
