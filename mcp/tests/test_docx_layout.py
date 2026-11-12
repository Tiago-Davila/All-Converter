"""Pruebas de página e imágenes de DOCX (#107 / T028)."""

from collections.abc import Callable
from pathlib import Path

import pytest
from docx.enum.section import WD_ORIENT
from pydantic import ValidationError

from convertitodo_mcp.blocks import Imagen
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado, ErrorLimiteExcedido
from convertitodo_mcp.render.docx_layout import (
    MargenesDOCX,
    OpcionesDOCX,
    crear_documento,
    insertar_imagen,
)
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def test_pagina_predeterminada_y_estilos() -> None:
    doc = crear_documento(OpcionesDOCX())
    seccion = doc.sections[0]
    assert seccion.page_width.mm == pytest.approx(210, abs=0.1)
    assert seccion.page_height.mm == pytest.approx(297, abs=0.1)
    assert seccion.left_margin.mm == pytest.approx(25, abs=0.1)
    assert doc.styles["Normal"].font.name == "Noto Sans"
    assert doc.styles["Normal"].font.size.pt == 11
    assert str(doc.styles["Heading 1"].font.color.rgb) == "000000"


def test_carta_horizontal_y_margenes() -> None:
    opciones = OpcionesDOCX(
        tamano="Carta", orientacion="horizontal", margenes=MargenesDOCX(superior=10, izquierdo=15)
    )
    seccion = crear_documento(opciones).sections[0]
    assert seccion.orientation == WD_ORIENT.LANDSCAPE
    assert seccion.page_width.mm == pytest.approx(279.4, abs=0.1)
    assert seccion.page_height.mm == pytest.approx(215.9, abs=0.1)
    assert seccion.top_margin.mm == pytest.approx(10, abs=0.1)
    assert seccion.left_margin.mm == pytest.approx(15, abs=0.1)


@pytest.mark.parametrize("valor", [-1, float("inf"), float("nan"), 200])
def test_margenes_invalidos(valor: float) -> None:
    with pytest.raises(ValidationError):
        OpcionesDOCX(margenes=MargenesDOCX(izquierdo=valor))


def test_imagen_real_ajustada_y_texto_alternativo(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    config = Configuracion(carpeta_trabajo=tmp_path)
    doc = crear_documento(OpcionesDOCX())
    insertar_imagen(
        doc,
        Imagen(archivo=archivo.id, ancho_mm=500, texto_alternativo="Ejemplo"),
        almacen=almacen,
        config=config,
    )
    imagen = doc.inline_shapes[0]
    seccion = doc.sections[0]
    assert imagen.width <= seccion.page_width - seccion.left_margin - seccion.right_margin
    assert imagen.height <= seccion.page_height - seccion.top_margin - seccion.bottom_margin
    assert imagen._inline.docPr.get("descr") == "Ejemplo"


def test_imagen_invalida_y_sin_almacen(tmp_path: Path) -> None:
    doc = crear_documento(OpcionesDOCX())
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("invalida.png", b"no es una imagen")
    bloque = Imagen(archivo=archivo.id)
    with pytest.raises(ErrorArgumento):
        insertar_imagen(doc, bloque)
    with pytest.raises(ErrorFormatoNoSoportado):
        insertar_imagen(
            doc, bloque, almacen=almacen, config=Configuracion(carpeta_trabajo=tmp_path)
        )


def test_imagen_excede_limite(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("grande.png", b"x" * (1024 * 1024 + 1))
    with pytest.raises(ErrorLimiteExcedido):
        insertar_imagen(
            crear_documento(OpcionesDOCX()),
            Imagen(archivo=archivo.id),
            almacen=almacen,
            config=Configuracion(carpeta_trabajo=tmp_path, max_mb=1),
        )
