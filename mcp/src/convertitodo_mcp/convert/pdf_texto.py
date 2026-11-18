"""PDF con capa de texto a Markdown, bloques y Word, con estructura inferida."""

import re
from collections import Counter

from convertitodo_mcp.blocks import Bloque, markdown_a_bloques
from convertitodo_mcp.limites import verificar_bloques, verificar_tamano, verificar_texto
from convertitodo_mcp.read.markitdown import leer_markitdown
from convertitodo_mcp.read.modelos import EntradaDocumento
from convertitodo_mcp.read.respaldo import abrir_pdf
from convertitodo_mcp.render.docx import renderizar_docx
from convertitodo_mcp.server.config import Configuracion

_MAX_LARGO_TITULO = 100
_MAX_LARGO_MAYUSCULAS = 60
_RELACION_TITULO = 1.15
_RELACION_NIVEL_1 = 1.6
_RELACION_NIVEL_2 = 1.3
_LARGO_LINEA_LARGA = 50

_VINETA = re.compile(r"^[•◦▪▫‣●○·\u2013\u2014\-*]\s+(?=\S)")
_NUMERADA = re.compile(r"^(\d{1,3})[.)]\s+(?=\S)")
_SECCION = re.compile(r"^(\d{1,2}(?:\.\d{1,2})+)\.?\s+(?=\S)")
_PUNTOS_GUIA = re.compile(r"\.{4,}|…{2,}")
_FIN_ORACION = (".", "!", "?", ":", ";", "…")
_ESPECIALES = re.compile(r"([\\`*_\[\]<>|~&])")
_ESCAPAR_INICIO = re.compile(r"^(#|>|-|\+|=|\d+(?=[.)]))")


# Normaliza espacios para comparar líneas de dos extractores distintos.
def _normalizar(texto: str) -> str:
    return " ".join(texto.split())


# Escapa el texto para que el parser Markdown nunca lo interprete como formato ni enlaces.
def _escapar(texto: str) -> str:
    texto = _ESPECIALES.sub(r"\\\1", texto)
    inicio = _ESCAPAR_INICIO.match(texto)
    if inicio is None:
        return texto
    marca = inicio.group(1)
    if marca.isdigit():
        return marca + "\\" + texto[len(marca) :]
    return "\\" + texto


# Mapea cada línea del PDF a su tamaño de fuente y devuelve también el tamaño del cuerpo.
def _tamanos(datos: bytes) -> tuple[dict[str, float], float]:
    pdf = abrir_pdf(datos)
    por_texto: dict[str, float] = {}
    pesos: Counter[float] = Counter()

    # Recibe cada fragmento de texto con su matriz para estimar el tamaño real.
    def visitante(
        texto: str,
        cm: list[float],
        tm: list[float],
        _fuente: object,
        tamano: float,
    ) -> None:
        limpio = _normalizar(texto)
        if not limpio:
            return
        escala = abs(tm[3] if tm[3] else 1.0) * abs(cm[3] if cm[3] else 1.0)
        real = round(tamano * escala, 1)
        if real < 4:
            return
        por_texto[limpio] = max(por_texto.get(limpio, 0.0), real)
        pesos[real] += len(limpio)

    try:
        for pagina in pdf.pages:
            pagina.extract_text(visitor_text=visitante)
    except Exception:
        # La señal de tamaño es opcional: sin ella quedan las demás heurísticas.
        return {}, 0.0
    cuerpo = pesos.most_common(1)[0][0] if pesos else 0.0
    return por_texto, cuerpo


# Nivel de título por tamaño de fuente respecto del cuerpo, o 0 si no es título.
def _nivel_por_tamano(linea: str, tamanos: dict[str, float], cuerpo: float) -> int:
    tamano = tamanos.get(_normalizar(linea), 0.0)
    if not cuerpo or not tamano or len(linea) > _MAX_LARGO_TITULO:
        return 0
    relacion = tamano / cuerpo
    if relacion < _RELACION_TITULO:
        return 0
    if relacion >= _RELACION_NIVEL_1:
        return 1
    return 2 if relacion >= _RELACION_NIVEL_2 else 3


# Nivel de título por forma del texto: sección numerada o línea corta en mayúsculas.
def _nivel_por_forma(linea: str, sola: bool) -> tuple[int, str]:
    if len(linea) > _MAX_LARGO_TITULO or linea.endswith(_FIN_ORACION) or _PUNTOS_GUIA.search(linea):
        return 0, linea
    seccion = _SECCION.match(linea)
    if seccion is not None:
        return min(seccion.group(1).count(".") + 1, 6), linea
    if sola and _NUMERADA.match(linea):
        return 2, linea
    letras = [c for c in linea if c.isalpha()]
    if sola and len(letras) >= 3 and len(linea) <= _MAX_LARGO_MAYUSCULAS and linea.isupper():
        return 2, linea
    return 0, linea


# Decide si una línea continúa el párrafo anterior en vez de abrir uno nuevo.
def _continua(anterior: str, actual: str) -> bool:
    if _PUNTOS_GUIA.search(anterior) or _PUNTOS_GUIA.search(actual):
        return False
    if _VINETA.match(actual) or _NUMERADA.match(actual) or _SECCION.match(actual):
        return False
    if anterior.endswith(_FIN_ORACION):
        return False
    return actual[:1].islower() or len(anterior) >= _LARGO_LINEA_LARGA


# Une dos líneas, deshaciendo el guion de corte de palabra al final del renglón.
def _unir(anterior: str, actual: str) -> str:
    if anterior.endswith("-") and anterior[-2:-1].isalpha() and actual[:1].islower():
        return anterior[:-1] + actual
    return anterior + " " + actual


# Convierte las líneas de una página en piezas de Markdown; `solas` marca las rodeadas de blancos.
def _lineas_a_markdown(
    lineas: list[str], solas: list[bool], tamanos: dict[str, float], cuerpo: float
) -> list[str]:
    piezas: list[str] = []
    parrafo: str | None = None
    lista: list[str] = []

    def cerrar() -> None:
        nonlocal parrafo, lista
        if parrafo is not None:
            piezas.append(_escapar(parrafo))
            parrafo = None
        if lista:
            piezas.append("\n".join(lista))
            lista = []

    for linea, sola in zip(lineas, solas, strict=True):
        nivel = _nivel_por_tamano(linea, tamanos, cuerpo)
        texto = linea
        if not nivel:
            nivel, texto = _nivel_por_forma(linea, sola=sola)
        if nivel:
            cerrar()
            piezas.append("#" * nivel + " " + _escapar(texto))
            continue
        vineta = _VINETA.match(linea)
        numerada = _NUMERADA.match(linea)
        if vineta is not None or numerada is not None:
            if parrafo is not None:
                piezas.append(_escapar(parrafo))
                parrafo = None
            if vineta is not None:
                lista.append("- " + _escapar(linea[vineta.end() :]))
            elif numerada is not None:
                lista.append(f"{numerada.group(1)}. " + _escapar(linea[numerada.end() :]))
            continue
        if lista and not _continua(lista[-1], linea):
            cerrar()
        if lista:
            lista[-1] = _unir(lista[-1], _escapar(linea))
        elif parrafo is not None and _continua(parrafo, linea):
            parrafo = _unir(parrafo, linea)
        else:
            cerrar()
            parrafo = linea
    cerrar()
    return piezas


# Aplica las heurísticas de estructura al texto de una página.
def _pagina_a_markdown(texto: str, tamanos: dict[str, float], cuerpo: float) -> str:
    crudas = [_normalizar(linea) for linea in texto.replace("\x0c", "").splitlines()]
    # Los extractores ponen blancos entre renglones de un mismo párrafo: no son cortes fiables.
    lineas = [linea for linea in crudas if linea]
    solas = [
        (i == 0 or not crudas[i - 1]) and (i == len(crudas) - 1 or not crudas[i + 1])
        for i, linea in enumerate(crudas)
        if linea
    ]
    return "\n\n".join(_lineas_a_markdown(lineas, solas, tamanos, cuerpo))


def pdf_a_markdown(datos: bytes, config: Configuracion, *, nombre: str = "documento.pdf") -> str:
    """Markdown con títulos, listas y párrafos inferidos; las tablas llegan como texto plano.

    Las páginas se separan con una línea en blanco (sin `---`, que sería un salto de página).
    Fidelidad parcial: solo texto y estructura básica, sin diseño ni imágenes.
    """
    verificar_tamano(len(datos), config, que="el PDF")
    # leer_markitdown aporta el texto y los errores de PDF escaneado, protegido o corrupto.
    leido = leer_markitdown(EntradaDocumento(nombre, "pdf", datos), config)
    tamanos, cuerpo = _tamanos(datos)
    paginas = [_pagina_a_markdown(p, tamanos, cuerpo) for p in leido.paginas]
    markdown = "\n\n".join(p for p in paginas if p)
    verificar_texto(markdown, config, que="el texto extraído")
    return markdown


def pdf_a_bloques(
    datos: bytes, config: Configuracion, *, nombre: str = "documento.pdf"
) -> list[Bloque]:
    """Bloques del modelo a partir del Markdown inferido; el texto se trata como dato."""
    bloques = markdown_a_bloques(pdf_a_markdown(datos, config, nombre=nombre))
    verificar_bloques(bloques, config)
    return bloques


def pdf_a_docx(
    datos: bytes, config: Configuracion, *, nombre: str = "documento.pdf", titulo: str = ""
) -> bytes:
    """Word editable con estilos nativos; fidelidad parcial: texto y estructura básica.

    No conserva diseño, columnas, imágenes ni tablas (el texto de las celdas queda como párrafos).
    """
    return renderizar_docx(
        pdf_a_bloques(datos, config, nombre=nombre), config=config, titulo=titulo
    )
