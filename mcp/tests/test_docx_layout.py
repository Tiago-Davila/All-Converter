"""Pruebas de página e imágenes de DOCX (#107 / T028)."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path
from typing import cast

import pytest
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn
from docx.shared import Mm
from docx.styles.style import _ParagraphStyle
from pydantic import ValidationError

from convertitodo_mcp.blocks import Imagen
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado, ErrorLimiteExcedido
from convertitodo_mcp.render.docx_layout import (
    MargenesDOCX,
    OpcionesDOCX,
    cargar_documento,
    crear_documento,
    insertar_imagen,
    insertar_tabla_contenido,
)
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def test_pagina_predeterminada_y_estilos() -> None:
    doc = crear_documento(OpcionesDOCX())
    seccion = doc.sections[0]
    assert seccion.page_width is not None and seccion.page_height is not None
    assert seccion.left_margin is not None
    assert seccion.page_width.mm == pytest.approx(210, abs=0.1)
    assert seccion.page_height.mm == pytest.approx(297, abs=0.1)
    assert seccion.left_margin.mm == pytest.approx(25, abs=0.1)
    normal = cast(_ParagraphStyle, doc.styles["Normal"])
    assert normal.font.name == "Noto Sans"
    assert normal.font.size is not None and normal.font.size.pt == 11
    assert str(cast(_ParagraphStyle, doc.styles["Heading 1"]).font.color.rgb) == "000000"


def test_indice_es_opcional_y_usa_estilos_de_titulo() -> None:
    sin_indice = crear_documento(OpcionesDOCX())
    assert not sin_indice.element.body.xpath(".//w:fldSimple")
    assert sin_indice.settings.element.find(qn("w:updateFields")) is None

    doc = crear_documento(OpcionesDOCX(tabla_contenido=True))
    insertar_tabla_contenido(doc)
    campos = doc.element.body.xpath(".//w:fldSimple")
    assert len(campos) == 1
    assert campos[0].get(qn("w:instr")) == r'TOC \o "1-6" \h \z \u'
    assert campos[0].get(qn("w:dirty")) == "true"
    assert doc.paragraphs[0].style.name == "Title"
    ajuste = doc.settings.element.find(qn("w:updateFields"))
    assert ajuste is not None and ajuste.get(qn("w:val")) == "true"


def test_indice_actualiza_ajuste_existente_sin_duplicarlo() -> None:
    doc = crear_documento(OpcionesDOCX(tabla_contenido=True))
    insertar_tabla_contenido(doc)
    ajuste = doc.settings.element.find(qn("w:updateFields"))
    assert ajuste is not None
    ajuste.set(qn("w:val"), "false")
    insertar_tabla_contenido(doc)
    ajustes = doc.settings.element.findall(qn("w:updateFields"))
    assert len(ajustes) == 1
    assert ajustes[0].get(qn("w:val")) == "true"


def test_carta_horizontal_y_margenes() -> None:
    opciones = OpcionesDOCX(
        tamano="Carta", orientacion="horizontal", margenes=MargenesDOCX(superior=10, izquierdo=15)
    )
    seccion = crear_documento(opciones).sections[0]
    assert seccion.page_width is not None and seccion.page_height is not None
    assert seccion.top_margin is not None and seccion.left_margin is not None
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
    assert seccion.page_width is not None and seccion.page_height is not None
    assert seccion.left_margin is not None and seccion.right_margin is not None
    assert seccion.top_margin is not None and seccion.bottom_margin is not None
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


def test_plantilla_real_conserva_contenido_y_opciones(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path)
    inicial = almacen.guardar_subida("inicial.docx", fixture_bytes("sample.docx"))
    original = cargar_documento(inicial.id, almacen, config)
    original.sections[0].top_margin = Mm(17)
    salida = BytesIO()
    original.save(salida)
    archivo = almacen.guardar_subida("plantilla.docx", salida.getvalue())
    doc = crear_documento(OpcionesDOCX(plantilla=archivo.id), almacen=almacen, config=config)
    assert [p.text for p in doc.paragraphs] == [p.text for p in original.paragraphs]
    assert len(doc.sections) == len(original.sections)
    assert doc.sections[0].left_margin == original.sections[0].left_margin
    assert doc.styles["Normal"].element.xml == original.styles["Normal"].element.xml
    assert doc.sections[0].header._element.xml == original.sections[0].header._element.xml
    assert doc.sections[0].footer._element.xml == original.sections[0].footer._element.xml
    cambiado = crear_documento(
        OpcionesDOCX(plantilla=archivo.id, margenes=MargenesDOCX(izquierdo=30)),
        almacen=almacen,
        config=config,
    )
    assert cambiado.sections[0].left_margin is not None
    assert cambiado.sections[0].left_margin.mm == pytest.approx(30, abs=0.1)
    assert cambiado.sections[0].top_margin == original.sections[0].top_margin
    assert cambiado.styles["Normal"].element.xml == original.styles["Normal"].element.xml


@pytest.mark.parametrize(
    "entrada,contenido",
    [
        ("word/evil.bin", b"macro"),
        ("word/evil.xml", b'<!DOCTYPE a [<!ENTITY x "x">]><a>&x;</a>'),
        (
            "word/_rels/evil.xml.rels",
            b'<Relationships><Relationship TargetMode="External" '
            b'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            b'Target="https://example.com/a.png"/></Relationships>',
        ),
    ],
)
def test_plantilla_rechaza_contenido_peligroso(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], entrada: str, contenido: bytes
) -> None:
    from zipfile import ZIP_DEFLATED, ZipFile

    salida = BytesIO()
    with ZipFile(BytesIO(fixture_bytes("sample.docx"))) as original:
        with ZipFile(salida, "w", ZIP_DEFLATED) as modificado:
            for info in original.infolist():
                modificado.writestr(info, original.read(info))
            modificado.writestr(entrada, contenido)
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("malo.docx", salida.getvalue())
    with pytest.raises(ErrorFormatoNoSoportado):
        cargar_documento(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path))


def test_plantilla_corrupta(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("malo.docx", b"no es un zip")
    with pytest.raises(ErrorFormatoNoSoportado):
        cargar_documento(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path))
