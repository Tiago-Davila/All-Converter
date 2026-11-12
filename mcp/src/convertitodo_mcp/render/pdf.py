"""Renderizado de bloques de documento a PDF con Platypus."""

from collections.abc import Sequence
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    Flowable,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Table,
    TableStyle,
)

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
from convertitodo_mcp.render.fuentes import MONO, NORMAL, NEGRITA, registrar_fuentes


def _texto(tramos: Sequence[Tramo]) -> str:
    partes = []
    for tramo in tramos:
        texto = escape(tramo.texto).replace("\n", "<br/>")
        if tramo.codigo:
            texto = f'<font name="{MONO}">{texto}</font>'
        if tramo.negrita:
            texto = f"<b>{texto}</b>"
        if tramo.italica:
            texto = f"<i>{texto}</i>"
        if tramo.enlace:
            texto = f'<link href="{escape(tramo.enlace, quote=True)}">{texto}</link>'
        partes.append(texto)
    return "".join(partes)


def _lista(lista: Lista, base: ParagraphStyle, nivel: int = 0) -> list[Flowable]:
    elementos: list[Flowable] = []
    estilo = ParagraphStyle("lista", parent=base, leftIndent=18 * (nivel + 1), firstLineIndent=-14)
    for numero, item in enumerate(lista.items, start=1):
        marcador = f"{numero}." if lista.ordenada else "•"
        elementos.append(Paragraph(f"{marcador}  {_texto(item.texto)}", estilo))
        if item.sublista is not None:
            elementos.extend(_lista(item.sublista, base, nivel + 1))
    return elementos


def renderizar_pdf(bloques: Sequence[Bloque]) -> bytes:
    """Devuelve un PDF en memoria a partir de los bloques indicados."""
    registrar_fuentes()
    salida = BytesIO()
    documento = SimpleDocTemplate(salida)
    normal = ParagraphStyle("normal", fontName=NORMAL, fontSize=10, leading=15, spaceAfter=8)
    contenido: list[Flowable] = []
    for bloque in bloques:
        if isinstance(bloque, Titulo):
            tamano = 19 - bloque.nivel * 2
            estilo = ParagraphStyle(
                "titulo",
                parent=normal,
                fontName=NEGRITA,
                fontSize=tamano,
                leading=tamano * 1.3,
                spaceBefore=10,
                keepWithNext=True,
            )
            contenido.append(Paragraph(_texto(bloque.texto), estilo))
        elif isinstance(bloque, Parrafo):
            contenido.append(Paragraph(_texto(bloque.texto), normal))
        elif isinstance(bloque, Cita):
            estilo = ParagraphStyle("cita", parent=normal, leftIndent=24, rightIndent=24)
            contenido.append(Paragraph(_texto(bloque.texto), estilo))
        elif isinstance(bloque, Lista):
            contenido.extend(_lista(bloque, normal))
        elif isinstance(bloque, Tabla):
            filas = ([bloque.encabezado] if bloque.encabezado else []) + bloque.filas
            if filas and filas[0]:
                cabecera = ParagraphStyle("cabecera", parent=normal, fontName=NEGRITA)
                celdas = [
                    [
                        Paragraph(
                            _texto(celda), cabecera if bloque.encabezado and indice == 0 else normal
                        )
                        for celda in fila
                    ]
                    for indice, fila in enumerate(filas)
                ]
                # El frame predeterminado resta 6 puntos de padding en cada lado.
                ancho_columna = (documento.width - 12) / len(filas[0])
                tabla = Table(
                    celdas,
                    colWidths=[ancho_columna] * len(filas[0]),
                    repeatRows=1 if bloque.encabezado else 0,
                    hAlign="LEFT",
                )
                tabla.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey)]))
                contenido.append(tabla)
        elif isinstance(bloque, Codigo):
            estilo = ParagraphStyle("codigo", parent=normal, fontName=MONO, fontSize=9)
            contenido.append(Preformatted(bloque.texto, estilo, maxLineLength=90, splitChars=" "))
        elif isinstance(bloque, SaltoPagina):
            contenido.append(PageBreak())
        elif isinstance(bloque, Imagen):
            raise ValueError("Las imágenes requieren un almacén de archivos.")
    documento.build(contenido)
    return salida.getvalue()
