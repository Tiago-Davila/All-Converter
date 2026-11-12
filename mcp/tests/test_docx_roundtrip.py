"""Pruebas de ida y vuelta de documentos DOCX con fixtures reales."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.shared import Mm

from convertitodo_mcp.blocks import Bloque, Imagen, SaltoPagina, markdown_a_bloques
from convertitodo_mcp.render.docx import renderizar_docx
from convertitodo_mcp.render.docx_layout import OpcionesDOCX
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def test_markdown_real_a_docx_editable(fixture_bytes: Callable[[str], bytes]) -> None:
    markdown = fixture_bytes("sample.md").decode("utf-8")
    markdown += "\n\nEspañol: ñ, áéíóú, €.\n"
    documento = Document(BytesIO(renderizar_docx(markdown_a_bloques(markdown))))
    parrafos = documento.paragraphs
    assert any(
        p.text == "Informe de ventas" and p.style is not None and p.style.name == "Heading 1"
        for p in parrafos
    )
    assert any(
        p.text == "Productos destacados" and p.style is not None and p.style.name == "Heading 2"
        for p in parrafos
    )
    assert any(
        p.text == "Café de especialidad" and p.style is not None and p.style.name == "List Bullet"
        for p in parrafos
    )
    assert any(
        p.text == "Recibir el pedido" and p.style is not None and p.style.name == "List Number"
        for p in parrafos
    )
    assert any("ñ, áéíóú, €" in p.text for p in parrafos)
    runs = [run for parrafo in parrafos for run in parrafo.runs]
    assert any(run.text == "negrita" and run.bold for run in runs)
    assert any(run.text == "itálica" and run.italic for run in runs)
    assert any(run.text == "npm run ci" and run.font.name == "Noto Sans Mono" for run in runs)
    assert any(
        enlace.text == "la guía interna" and enlace.address == "https://ejemplo.local/guia"
        for parrafo in parrafos
        for enlace in parrafo.hyperlinks
    )
    tabla = documento.tables[0]
    assert [celda.text for celda in tabla.rows[0].cells] == ["Producto", "Unidades", "Precio"]
    assert [celda.text for celda in tabla.rows[1].cells] == ["Café", "120", "100"]
    assert "w:tblHeader" in tabla.rows[0]._tr.xml


def test_imagen_salto_y_opciones_en_docx_reabierto(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    config = Configuracion(carpeta_trabajo=tmp_path)
    opciones = OpcionesDOCX.model_validate(
        {"tamano": "Carta", "orientacion": "horizontal", "margenes": {"izquierdo": 30}}
    )
    bloques: list[Bloque] = [
        Imagen(archivo=archivo.id, ancho_mm=25, texto_alternativo="Imagen de prueba"),
        SaltoPagina(),
    ]
    documento = Document(
        BytesIO(renderizar_docx(bloques, opciones, almacen=almacen, config=config))
    )
    assert len(documento.inline_shapes) == 1
    assert abs(documento.inline_shapes[0].width - Mm(25)) <= 1
    assert documento.inline_shapes[0]._inline.docPr.get("descr") == "Imagen de prueba"
    assert any('w:type="page"' in parrafo._p.xml for parrafo in documento.paragraphs)
    seccion = documento.sections[0]
    assert seccion.orientation == WD_ORIENT.LANDSCAPE
    assert seccion.page_width == Mm(279.4)
    assert seccion.page_height == Mm(215.9)
    assert seccion.left_margin is not None
    assert abs(seccion.left_margin - Mm(30)) <= Mm(0.02)
