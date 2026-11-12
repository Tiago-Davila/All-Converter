"""Renderizado de bloques editables a DOCX."""

from collections.abc import Sequence
from io import BytesIO

from docx.document import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from convertitodo_mcp.blocks import (
    Bloque,
    Cita,
    Codigo,
    Lista,
    Parrafo,
    SaltoPagina,
    Tabla,
    Titulo,
    texto_plano,
)
from convertitodo_mcp.render.docx_layout import OpcionesDOCX, crear_documento
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def _agregar_lista(documento: Document, lista: Lista, nivel: int = 0) -> None:
    estilo = "List Number" if lista.ordenada else "List Bullet"
    for item in lista.items:
        parrafo = documento.add_paragraph(texto_plano(item.texto), style=estilo)
        if nivel:
            parrafo.paragraph_format.left_indent = Pt(36 * (nivel + 1))
            parrafo.paragraph_format.first_line_indent = Pt(-18)
        if item.sublista is not None:
            _agregar_lista(documento, item.sublista, nivel + 1)


def _agregar_tabla(documento: Document, bloque: Tabla) -> None:
    filas = ([bloque.encabezado] if bloque.encabezado is not None else []) + bloque.filas
    if not filas or not filas[0]:
        return
    tabla = documento.add_table(rows=0, cols=len(filas[0]))
    bordes = OxmlElement("w:tblBorders")
    for lado in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borde = OxmlElement(f"w:{lado}")
        borde.set(qn("w:val"), "single")
        borde.set(qn("w:sz"), "4")
        borde.set(qn("w:color"), "808080")
        bordes.append(borde)
    tabla._tbl.tblPr.append(bordes)
    for indice, fila in enumerate(filas):
        fila_docx = tabla.add_row()
        es_encabezado = bloque.encabezado is not None and indice == 0
        if es_encabezado:
            fila_docx._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
        for celda, tramos in zip(fila_docx.cells, fila, strict=True):
            run = celda.paragraphs[0].add_run(texto_plano(tramos))
            if es_encabezado:
                run.bold = True


def agregar_bloques(
    documento: Document,
    bloques: Sequence[Bloque],
    *,
    almacen: Almacen | None = None,
    config: Configuracion | None = None,
) -> None:
    """Agrega bloques al final de un documento existente."""
    for bloque in bloques:
        if isinstance(bloque, Titulo):
            documento.add_heading(texto_plano(bloque.texto), level=min(bloque.nivel, 3))
        elif isinstance(bloque, Parrafo):
            documento.add_paragraph(texto_plano(bloque.texto))
        elif isinstance(bloque, Lista):
            _agregar_lista(documento, bloque)
        elif isinstance(bloque, Tabla):
            _agregar_tabla(documento, bloque)
        elif isinstance(bloque, Cita):
            documento.add_paragraph(texto_plano(bloque.texto), style="Quote")
        elif isinstance(bloque, Codigo):
            parrafo = documento.add_paragraph()
            parrafo.add_run(bloque.texto).font.name = "Noto Sans Mono"
        elif isinstance(bloque, SaltoPagina):
            documento.add_page_break()


def renderizar_docx(
    bloques: Sequence[Bloque],
    opciones: OpcionesDOCX | None = None,
    *,
    almacen: Almacen | None = None,
    config: Configuracion | None = None,
    titulo: str = "",
) -> bytes:
    """Devuelve un documento DOCX en memoria."""
    documento = crear_documento(opciones or OpcionesDOCX(), almacen=almacen, config=config)
    documento.core_properties.title = titulo
    if titulo:
        documento.add_paragraph(titulo, style="Title")
    agregar_bloques(documento, bloques, almacen=almacen, config=config)
    salida = BytesIO()
    documento.save(salida)
    return salida.getvalue()
