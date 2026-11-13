"""Conversiones desde Word: a bloques, a PDF y a Excel (solo tablas)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Literal

from docx import Document
from docx.document import Document as DocumentoWord
from docx.oxml.ns import qn
from docx.table import Table as TablaWord
from docx.table import _Cell as CeldaWord
from docx.text.hyperlink import Hyperlink
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from convertitodo_mcp.blocks import (
    Bloque,
    Imagen,
    ItemLista,
    Lista,
    Parrafo,
    SaltoPagina,
    Tabla,
    Titulo,
    Tramo,
)
from convertitodo_mcp.blocks.modelo import ESQUEMAS_ENLACE_PERMITIDOS, PROFUNDIDAD_MAXIMA_LISTA
from convertitodo_mcp.blocks.planilla import Planilla
from convertitodo_mcp.convert.texto_a_planilla import hoja_desde_tabla
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado
from convertitodo_mcp.limites import verificar_bloques, verificar_tamano
from convertitodo_mcp.read.deteccion import detectar_tipo, validar_paquete
from convertitodo_mcp.render.pdf import OpcionesPDF, renderizar_pdf
from convertitodo_mcp.render.xlsx import renderizar_xlsx
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

_TITULO = re.compile(r"(?:heading|t[ií]tulo)\s*(\d)", re.IGNORECASE)
_LISTA_NUMERADA = re.compile(r"list number|lista con números|lista numerada", re.IGNORECASE)
_LISTA_VINETAS = re.compile(r"list bullet|lista con viñetas", re.IGNORECASE)
_FIRMAS_IMAGEN = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")
_NOMBRE_HOJA = "Tabla{}"


# Pieza de un párrafo en orden de aparición: texto, salto de página o imagen incrustada.
@dataclass(frozen=True, slots=True)
class _Pieza:
    clase: Literal["texto", "salto", "imagen"]
    tramos: list[Tramo] = field(default_factory=list)
    datos: bytes = b""


# Item de lista en construcción, con sus hijos por nivel de anidación.
@dataclass(slots=True)
class _Nodo:
    tramos: list[Tramo]
    ordenada: bool
    hijos: list[_Nodo] = field(default_factory=list)


def _abrir(datos: bytes, config: Configuracion) -> DocumentoWord:
    # Reutiliza la validación del paquete (macros, recursos externos, tamaño descomprimido).
    verificar_tamano(len(datos), config, que="el documento")
    if detectar_tipo(datos, "documento.docx") != "docx":
        raise ErrorFormatoNoSoportado(
            "El archivo no es un documento Word (.docx).", "subí un archivo .docx válido."
        )
    validar_paquete(datos, config)
    try:
        return Document(BytesIO(datos))
    except Exception:
        raise ErrorFormatoNoSoportado(
            "No se pudo abrir el documento Word.", "guardalo de nuevo como .docx y reintentá."
        ) from None


def _nivel_titulo(parrafo: Paragraph) -> int | None:
    estilo = parrafo.style
    nombre = estilo.name if estilo is not None and estilo.name else ""
    if nombre.lower() == "title":
        return 1
    coincide = _TITULO.fullmatch(nombre.strip())
    if coincide:
        return max(1, min(int(coincide.group(1)), 6))
    # Nivel de esquema explícito en el párrafo o en su estilo (0 = nivel 1; 9 = cuerpo).
    for origen in (parrafo._p, estilo.element if estilo is not None else None):
        if origen is None:
            continue
        valores = origen.xpath("./w:pPr/w:outlineLvl/@w:val")
        if valores and str(valores[0]).isdigit() and int(valores[0]) <= 5:
            return int(valores[0]) + 1
    return None


# Resuelve si cada (lista, nivel) es numerada leyendo numbering.xml una sola vez.
class _Numeracion:
    def __init__(self, documento: DocumentoWord) -> None:
        self._abstractas: dict[str, str] = {}
        self._formatos: dict[tuple[str, str], str] = {}
        try:
            raiz = documento.part.numbering_part.element
        except Exception:
            return
        for num in raiz.findall(qn("w:num")):
            ident = num.get(qn("w:numId"))
            abstracta = num.find(qn("w:abstractNumId"))
            if ident is not None and abstracta is not None:
                self._abstractas[ident] = abstracta.get(qn("w:val")) or ""
        for abstracta in raiz.findall(qn("w:abstractNum")):
            ident = abstracta.get(qn("w:abstractNumId"))
            for nivel in abstracta.findall(qn("w:lvl")):
                ilvl = nivel.get(qn("w:ilvl"))
                formato = nivel.find(qn("w:numFmt"))
                if ident is not None and ilvl is not None and formato is not None:
                    self._formatos[(ident, ilvl)] = formato.get(qn("w:val")) or ""

    def ordenada(self, num_id: str, nivel: int) -> bool | None:
        abstracta = self._abstractas.get(num_id)
        formato = self._formatos.get((abstracta, str(nivel))) if abstracta is not None else None
        return None if formato is None else formato != "bullet"


def _item_lista(parrafo: Paragraph, numeracion: _Numeracion) -> tuple[int, bool] | None:
    """Devuelve (nivel, ordenada) si el párrafo es un item de lista."""
    estilo = parrafo.style
    nombre = estilo.name if estilo is not None and estilo.name else ""
    num_pr = parrafo._p.xpath("./w:pPr/w:numPr")
    if not num_pr and estilo is not None:
        num_pr = estilo.element.xpath("./w:pPr/w:numPr")
    nivel = -1
    ordenada: bool | None = None
    if num_pr:
        ident = num_pr[0].xpath("./w:numId/@w:val")
        if ident and str(ident[0]) == "0":
            return None
        ilvl = num_pr[0].xpath("./w:ilvl/@w:val")
        nivel = int(ilvl[0]) if ilvl and str(ilvl[0]).isdigit() else -1
        if ident:
            ordenada = numeracion.ordenada(str(ident[0]), max(nivel, 0))
    if ordenada is None:
        if _LISTA_NUMERADA.search(nombre):
            ordenada = True
        elif _LISTA_VINETAS.search(nombre) or num_pr:
            ordenada = False
        else:
            return None
    # Los estilos "List Bullet 2" indican el nivel en el nombre si no hay ilvl explícito.
    sufijo = re.search(r"(\d)$", nombre)
    if nivel < 0:
        nivel = max(int(sufijo.group(1)) - 1, 0) if sufijo else 0
    return min(nivel, PROFUNDIDAD_MAXIMA_LISTA - 1), ordenada


def _enlace_valido(url: str | None) -> str | None:
    if not url:
        return None
    esquema = url.split(":", 1)[0].lower() if ":" in url else ""
    return url if esquema in ESQUEMAS_ENLACE_PERMITIDOS else None


def _tramo(run: Run, enlace: str | None) -> Tramo | None:
    texto = run.text
    if not texto:
        return None
    return Tramo(texto=texto, negrita=bool(run.bold), italica=bool(run.italic), enlace=enlace)


def _agregar(tramos: list[Tramo], nuevo: Tramo | None) -> None:
    # Fusiona tramos contiguos con el mismo formato para no fragmentar el texto.
    if nuevo is None:
        return
    if tramos:
        previo = tramos[-1]
        if (previo.negrita, previo.italica, previo.enlace) == (
            nuevo.negrita,
            nuevo.italica,
            nuevo.enlace,
        ):
            tramos[-1] = previo.model_copy(update={"texto": previo.texto + nuevo.texto})
            return
    tramos.append(nuevo)


def _imagen_de(run: Run, parrafo: Paragraph) -> bytes | None:
    for ident in run._r.xpath(".//a:blip/@r:embed"):
        parte = parrafo.part.related_parts.get(str(ident))
        if parte is not None and parte.blob.startswith(_FIRMAS_IMAGEN):
            return bytes(parte.blob)
    return None


def _piezas(parrafo: Paragraph) -> list[_Pieza]:
    piezas: list[_Pieza] = []
    actuales: list[Tramo] = []

    def cerrar() -> None:
        nonlocal actuales
        if actuales:
            piezas.append(_Pieza("texto", actuales))
            actuales = []

    if parrafo.paragraph_format.page_break_before:
        piezas.append(_Pieza("salto"))
    for elemento in parrafo.iter_inner_content():
        if isinstance(elemento, Hyperlink):
            enlace = _enlace_valido(elemento.url)
            for run in elemento.runs:
                _agregar(actuales, _tramo(run, enlace))
            continue
        _agregar(actuales, _tramo(elemento, None))
        imagen = _imagen_de(elemento, parrafo)
        if imagen is not None:
            cerrar()
            piezas.append(_Pieza("imagen", datos=imagen))
        if elemento._r.xpath('./w:br[@w:type="page"]'):
            cerrar()
            piezas.append(_Pieza("salto"))
    cerrar()
    return piezas


def _texto_celda(celda: CeldaWord) -> str:
    # Las tablas anidadas aportan su texto dentro de la celda, separado por espacios.
    partes: list[str] = []
    for contenido in celda.iter_inner_content():
        if isinstance(contenido, Paragraph):
            partes.append(contenido.text)
        else:
            partes.extend(" ".join(_texto_celda(c) for c in fila.cells) for fila in contenido.rows)
    return "\n".join(p for p in partes if p.strip())


def _filas_tabla(tabla: TablaWord) -> list[list[str]]:
    """Texto por celda; las celdas combinadas aparecen solo en su posición original."""
    filas: list[list[str]] = []
    anteriores: list[object] = []
    for fila in tabla.rows:
        valores: list[str] = []
        actuales: list[object] = []
        for columna, celda in enumerate(fila.cells):
            elemento = celda._tc
            repetida = bool(actuales) and actuales[-1] is elemento
            vertical = columna < len(anteriores) and anteriores[columna] is elemento
            valores.append("" if repetida or vertical else _texto_celda(celda))
            actuales.append(elemento)
        anteriores = actuales
        filas.append(valores)
    ancho = max((len(f) for f in filas), default=0)
    return [f + [""] * (ancho - len(f)) for f in filas]


def _tabla_bloque(filas: list[list[str]]) -> Tabla:
    celdas = [[[Tramo(texto=t)] for t in fila] for fila in filas]
    return Tabla(encabezado=celdas[0], filas=celdas[1:])


def _lista_desde(nodos: list[_Nodo]) -> Lista:
    return Lista(
        ordenada=nodos[0].ordenada,
        items=[
            ItemLista(texto=n.tramos, sublista=_lista_desde(n.hijos) if n.hijos else None)
            for n in nodos
        ],
    )


# Agrupa items consecutivos en listas, anidando según el nivel de cada uno.
class _Acumulador:
    def __init__(self, bloques: list[Bloque]) -> None:
        self._bloques = bloques
        self._raiz: list[_Nodo] = []
        self._pila: list[_Nodo] = []

    def agregar(self, nivel: int, ordenada: bool, tramos: list[Tramo]) -> None:
        if self._raiz and nivel == 0 and self._raiz[0].ordenada != ordenada:
            self.cerrar()
        nivel = min(nivel, len(self._pila))
        del self._pila[nivel:]
        nodo = _Nodo(tramos, ordenada)
        (self._pila[-1].hijos if self._pila else self._raiz).append(nodo)
        self._pila.append(nodo)

    def cerrar(self) -> None:
        if self._raiz:
            self._bloques.append(_lista_desde(self._raiz))
        self._raiz = []
        self._pila = []


def _guardar_imagen(datos: bytes, almacen: Almacen | None, config: Configuracion) -> Imagen | None:
    if almacen is None:
        return None
    verificar_tamano(len(datos), config, que="la imagen")
    extension = "png" if datos.startswith(_FIRMAS_IMAGEN[0]) else "jpg"
    return Imagen(archivo=almacen.guardar_subida(f"imagen.{extension}", datos).id)


def docx_a_bloques(
    datos: bytes, config: Configuracion, *, almacen: Almacen | None = None
) -> list[Bloque]:
    """Lee el cuerpo en orden; sin almacén las imágenes se omiten (solo PNG y JPEG)."""
    documento = _abrir(datos, config)
    numeracion = _Numeracion(documento)
    bloques: list[Bloque] = []
    listas = _Acumulador(bloques)
    for contenido in documento.iter_inner_content():
        if isinstance(contenido, TablaWord):
            listas.cerrar()
            filas = _filas_tabla(contenido)
            if filas and filas[0]:
                bloques.append(_tabla_bloque(filas))
            continue
        piezas = _piezas(contenido)
        item = _item_lista(contenido, numeracion)
        nivel_titulo = None if item is not None else _nivel_titulo(contenido)
        if item is not None:
            tramos: list[Tramo] = []
            for pieza in piezas:
                for tramo in pieza.tramos:
                    _agregar(tramos, tramo)
            if any(t.texto.strip() for t in tramos):
                listas.agregar(item[0], item[1], tramos)
            piezas = [p for p in piezas if p.clase != "texto"]
        for pieza in piezas:
            if pieza.clase == "texto":
                if not any(t.texto.strip() for t in pieza.tramos):
                    continue
                listas.cerrar()
                if nivel_titulo is not None:
                    bloques.append(Titulo(nivel=nivel_titulo, texto=pieza.tramos))
                else:
                    bloques.append(Parrafo(texto=pieza.tramos))
            elif pieza.clase == "salto":
                listas.cerrar()
                bloques.append(SaltoPagina())
            else:
                imagen = _guardar_imagen(pieza.datos, almacen, config)
                if imagen is not None:
                    listas.cerrar()
                    bloques.append(imagen)
    listas.cerrar()
    verificar_bloques(bloques, config)
    return bloques


def docx_a_pdf(
    datos: bytes,
    config: Configuracion,
    *,
    almacen: Almacen | None = None,
    titulo: str = "",
) -> bytes:
    """Word a PDF con fidelidad parcial: no conserva fuentes, márgenes ni imágenes flotantes."""
    bloques = docx_a_bloques(datos, config, almacen=almacen)
    if not bloques:
        raise ErrorArgumento(
            "El documento Word no tiene contenido para convertir.",
            "agregá texto, tablas o imágenes en línea y volvé a intentar.",
        )
    return renderizar_pdf(bloques, OpcionesPDF(titulo=titulo), almacen=almacen, config=config)


def tablas_de_docx(datos: bytes, config: Configuracion | None = None) -> list[list[list[str]]]:
    """Texto de las celdas de cada tabla del cuerpo, en orden de aparición."""
    # Sin configuración se usan los límites por defecto; no se toca el disco.
    config = config or Configuracion(carpeta_trabajo=Path())
    documento = _abrir(datos, config)
    return [_filas_tabla(tabla) for tabla in documento.tables if tabla.rows]


def docx_a_xlsx(datos: bytes, config: Configuracion) -> bytes:
    """Una hoja por tabla (Tabla1, Tabla2…) con la primera fila como encabezado."""
    tablas = tablas_de_docx(datos, config)
    if not tablas:
        raise ErrorArgumento(
            "El documento no tiene tablas para pasar a Excel.",
            "usá un documento Word con al menos una tabla.",
        )
    hojas = [
        hoja_desde_tabla(_NOMBRE_HOJA.format(numero), tabla[0], tabla[1:])
        for numero, tabla in enumerate(tablas, start=1)
    ]
    return renderizar_xlsx(Planilla(hojas=hojas), config)
