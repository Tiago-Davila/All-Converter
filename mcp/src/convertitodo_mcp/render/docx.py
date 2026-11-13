"""Renderizado de bloques editables a DOCX."""

from collections.abc import Sequence
from io import BytesIO

from docx.document import Document
from docx.enum.text import WD_BREAK
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from convertitodo_mcp.blocks import (
    Bloque,
    Cita,
    Codigo,
    Imagen,
    Lista,
    Parrafo,
    SaltoPagina,
    Tabla,
    Titulo,
    Tramo,
)
from convertitodo_mcp.render.docx_layout import (
    OpcionesDOCX,
    crear_documento,
    insertar_imagen,
    insertar_tabla_contenido,
)
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def _agregar_tramos(parrafo: Paragraph, tramos: Sequence[Tramo], *, negrita: bool = False) -> None:
    for tramo in tramos:
        run = parrafo.add_run(tramo.texto)
        if negrita or tramo.negrita:
            run.bold = True
        if tramo.italica:
            run.italic = True
        if tramo.codigo:
            run.font.name = "Noto Sans Mono"
        if tramo.enlace:
            relacion = parrafo.part.relate_to(
                tramo.enlace, RELATIONSHIP_TYPE.HYPERLINK, is_external=True
            )
            enlace = OxmlElement("w:hyperlink")
            enlace.set(qn("r:id"), relacion)
            enlace.append(run._r)
            parrafo._p.append(enlace)


def _agregar_lista(documento: Document, lista: Lista, nivel: int = 0) -> None:
    numeracion = documento.part.numbering_part.element
    ids = [
        int(elemento.get(qn("w:abstractNumId")) or "0")
        for elemento in numeracion.findall(qn("w:abstractNum"))
    ]
    abstracto_id = max(ids, default=-1) + 1
    abstracto = OxmlElement("w:abstractNum")
    abstracto.set(qn("w:abstractNumId"), str(abstracto_id))
    tipo = OxmlElement("w:multiLevelType")
    tipo.set(qn("w:val"), "multilevel")
    abstracto.append(tipo)
    for indice in range(6):
        nivel_xml = OxmlElement("w:lvl")
        nivel_xml.set(qn("w:ilvl"), str(indice))
        for etiqueta, valor in (
            ("start", "1"),
            ("numFmt", "decimal" if lista.ordenada else "bullet"),
            ("lvlText", f"%{indice + 1}." if lista.ordenada else "•"),
        ):
            elemento = OxmlElement(f"w:{etiqueta}")
            elemento.set(qn("w:val"), valor)
            nivel_xml.append(elemento)
        propiedades = OxmlElement("w:pPr")
        sangria = OxmlElement("w:ind")
        sangria.set(qn("w:left"), str(720 * (indice + 1)))
        sangria.set(qn("w:hanging"), "360")
        propiedades.append(sangria)
        nivel_xml.append(propiedades)
        abstracto.append(nivel_xml)
    numeracion.insert_element_before(abstracto, "w:num", "w:numIdMacAtCleanup")
    num = numeracion.add_num(abstracto_id)
    estilo = "List Number" if lista.ordenada else "List Bullet"
    for item in lista.items:
        parrafo = documento.add_paragraph(style=estilo)
        _agregar_tramos(parrafo, item.texto)
        num_pr = parrafo._p.get_or_add_pPr().get_or_add_numPr()
        num_pr.get_or_add_ilvl().val = nivel
        num_pr.get_or_add_numId().val = num.numId
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
            _agregar_tramos(celda.paragraphs[0], tramos, negrita=es_encabezado)


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
            parrafo = documento.add_heading(level=min(bloque.nivel, 3))
            _agregar_tramos(parrafo, bloque.texto)
        elif isinstance(bloque, Parrafo):
            _agregar_tramos(documento.add_paragraph(), bloque.texto)
        elif isinstance(bloque, Lista):
            _agregar_lista(documento, bloque)
        elif isinstance(bloque, Tabla):
            _agregar_tabla(documento, bloque)
        elif isinstance(bloque, Cita):
            _agregar_tramos(documento.add_paragraph(style="Quote"), bloque.texto)
        elif isinstance(bloque, Codigo):
            parrafo = documento.add_paragraph()
            parrafo.add_run(bloque.texto).font.name = "Noto Sans Mono"
        elif isinstance(bloque, Imagen):
            insertar_imagen(documento, bloque, almacen=almacen, config=config)
        elif isinstance(bloque, SaltoPagina):
            documento.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def renderizar_docx(
    bloques: Sequence[Bloque],
    opciones: OpcionesDOCX | None = None,
    *,
    almacen: Almacen | None = None,
    config: Configuracion | None = None,
    titulo: str = "",
) -> bytes:
    """Devuelve un documento DOCX en memoria."""
    opciones = opciones or OpcionesDOCX()
    documento = crear_documento(opciones, almacen=almacen, config=config)
    documento.core_properties.title = titulo
    if titulo:
        documento.add_paragraph(titulo, style="Title")
    if opciones.tabla_contenido:
        insertar_tabla_contenido(documento)
    agregar_bloques(documento, bloques, almacen=almacen, config=config)
    salida = BytesIO()
    documento.save(salida)
    return salida.getvalue()
