"""Pruebas de PDF a imágenes e imágenes a PDF."""

from __future__ import annotations

import io
from collections.abc import Callable

import pytest
from PIL import Image
from pypdf import PdfReader

from convertitodo_mcp.convert import pdf_imagenes
from convertitodo_mcp.convert.pdf_imagenes import (
    MAX_IMAGENES_A_PDF,
    imagenes_a_pdf,
    pdf_a_imagenes,
)
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorConvertiTodo,
    ErrorLimiteExcedido,
)

FixtureBytes = Callable[[str], bytes]


def _jpeg(ancho: int, alto: int) -> bytes:
    salida = io.BytesIO()
    Image.new("RGB", (ancho, alto), (10, 120, 200)).save(salida, "JPEG")
    return salida.getvalue()


def test_pdf_a_png_nombres_y_formato(fixture_bytes: FixtureBytes) -> None:
    salidas = pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=36)
    assert [s.nombre for s in salidas] == [
        "documento-p1.png",
        "documento-p2.png",
        "documento-p3.png",
    ]
    for salida in salidas:
        with Image.open(io.BytesIO(salida.datos)) as imagen:
            assert imagen.format == "PNG"


def test_dpi_doble_ancho_doble(fixture_bytes: FixtureBytes) -> None:
    datos = fixture_bytes("text.pdf")
    anchos = []
    for dpi in (36, 72):
        salida = pdf_a_imagenes(datos, dpi=dpi, paginas="1")[0]
        with Image.open(io.BytesIO(salida.datos)) as imagen:
            anchos.append(imagen.width)
    assert abs(anchos[1] - 2 * anchos[0]) <= 2


def test_jpg_rgb(fixture_bytes: FixtureBytes) -> None:
    salida = pdf_a_imagenes(fixture_bytes("text.pdf"), "jpg", dpi=36, paginas="1")[0]
    assert salida.nombre == "documento-p1.jpg"
    with Image.open(io.BytesIO(salida.datos)) as imagen:
        assert imagen.format == "JPEG"
        assert imagen.mode == "RGB"


def test_rango_de_paginas(fixture_bytes: FixtureBytes) -> None:
    salidas = pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=36, paginas="2-3", nombre_base="x")
    assert [s.nombre for s in salidas] == ["x-p2.png", "x-p3.png"]


def test_pdf_escaneado(fixture_bytes: FixtureBytes) -> None:
    assert pdf_a_imagenes(fixture_bytes("scanned.pdf"), dpi=36)


@pytest.mark.parametrize("nombre", ["protected.pdf", "corrupt.pdf"])
def test_pdf_protegido_o_corrupto(fixture_bytes: FixtureBytes, nombre: str) -> None:
    with pytest.raises(ErrorConvertiTodo):
        pdf_a_imagenes(fixture_bytes(nombre), dpi=36)


@pytest.mark.parametrize("dpi", [10, 1000])
def test_dpi_fuera_de_rango(fixture_bytes: FixtureBytes, dpi: int) -> None:
    with pytest.raises(ErrorArgumento):
        pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=dpi)


def test_pagina_inexistente(fixture_bytes: FixtureBytes) -> None:
    with pytest.raises(ErrorArgumento):
        pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=36, paginas="9")


def test_tope_de_pixeles(fixture_bytes: FixtureBytes, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pdf_imagenes, "MAX_PIXELES_PAGINA", 1000)
    with pytest.raises(ErrorLimiteExcedido, match="dpi"):
        pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=36)


def test_imagenes_a_pdf_proporciones(fixture_bytes: FixtureBytes) -> None:
    imagenes = [fixture_bytes("sample.png"), fixture_bytes("images.png"), _jpeg(120, 60)]
    lector = PdfReader(io.BytesIO(imagenes_a_pdf(imagenes, titulo="Prueba")))
    assert len(lector.pages) == 3
    for pagina, datos in zip(lector.pages, imagenes, strict=True):
        with Image.open(io.BytesIO(datos)) as imagen:
            relacion = imagen.width / imagen.height
        assert float(pagina.mediabox.width) / float(pagina.mediabox.height) == pytest.approx(
            relacion, rel=0.01
        )


def test_imagen_con_transparencia() -> None:
    salida = io.BytesIO()
    Image.new("RGBA", (30, 20), (255, 0, 0, 0)).save(salida, "PNG")
    assert len(PdfReader(io.BytesIO(imagenes_a_pdf([salida.getvalue()]))).pages) == 1


def test_imagenes_vacio_y_exceso(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ErrorArgumento):
        imagenes_a_pdf([])
    monkeypatch.setattr(pdf_imagenes, "MAX_IMAGENES_A_PDF", 2)
    with pytest.raises(ErrorLimiteExcedido):
        imagenes_a_pdf([_jpeg(5, 5)] * 3)
    assert MAX_IMAGENES_A_PDF == 200


def test_imagen_corrupta_nombra_posicion() -> None:
    with pytest.raises(ErrorConvertiTodo, match="número 2"):
        imagenes_a_pdf([_jpeg(5, 5), b"\xff\xd8\xff basura"])


def test_ida_y_vuelta(fixture_bytes: FixtureBytes) -> None:
    imagenes = [s.datos for s in pdf_a_imagenes(fixture_bytes("text.pdf"), dpi=36)]
    assert len(PdfReader(io.BytesIO(imagenes_a_pdf(imagenes))).pages) == 3
