"""PDF a imágenes (pypdfium2) e imágenes a PDF (Pillow), todo en memoria."""

from __future__ import annotations

import io
import math
from collections.abc import Sequence
from typing import Literal

import pypdfium2 as pdfium
from PIL import Image

from convertitodo_mcp.convert.imagenes import abrir_imagen, aplanar_sobre_blanco
from convertitodo_mcp.convert.pdf_paginas import interpretar_rangos, paginas_de_rangos
from convertitodo_mcp.convert.tipos import SalidaConversion
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorConvertiTodo,
    ErrorLimiteExcedido,
)
from convertitodo_mcp.read.respaldo import abrir_pdf

DPI_POR_DEFECTO = 150
DPI_MINIMO = 36
DPI_MAXIMO = 300
MAX_PAGINAS_A_IMAGEN = 200
MAX_IMAGENES_A_PDF = 200
# Tope por página renderizada (el bitmap RGB ocupa ~3 bytes por píxel): menor que MAX_PIXELES
# de imagenes.py porque se renderizan muchas páginas seguidas.
MAX_PIXELES_PAGINA = 25_000_000

_PUNTOS_POR_PULGADA = 72


def _error_pdfium() -> ErrorArgumento:
    return ErrorArgumento("No se pudo renderizar el PDF.", "exportalo de nuevo y reintentá.")


def _validar_argumentos(formato: str, dpi: int, calidad: int) -> None:
    if formato not in ("png", "jpg"):
        raise ErrorArgumento(f"El formato de salida «{formato}» no es válido.", "usá png o jpg.")
    if isinstance(dpi, bool) or not isinstance(dpi, int) or not DPI_MINIMO <= dpi <= DPI_MAXIMO:
        raise ErrorArgumento(
            f"La resolución {dpi!r} dpi está fuera de rango.",
            f"indicá un entero entre {DPI_MINIMO} y {DPI_MAXIMO} dpi.",
        )
    if isinstance(calidad, bool) or not isinstance(calidad, int) or not 1 <= calidad <= 100:
        raise ErrorArgumento(
            f"La calidad {calidad!r} está fuera de rango.", "indicá un entero entre 1 y 100."
        )


def _codificar(imagen: Image.Image, formato: Literal["png", "jpg"], calidad: int) -> bytes:
    salida = io.BytesIO()
    if formato == "jpg":
        aplanar_sobre_blanco(imagen).save(salida, "JPEG", quality=calidad)
    else:
        imagen.convert("RGB").save(salida, "PNG", optimize=True)
    return salida.getvalue()


def pdf_a_imagenes(
    datos: bytes,
    formato: Literal["png", "jpg"] = "png",
    *,
    dpi: int = DPI_POR_DEFECTO,
    paginas: str | None = None,
    calidad: int = 85,
    nombre_base: str = "documento",
) -> list[SalidaConversion]:
    """Renderiza cada página elegida (o todas) como PNG/JPG; sirve también para PDF escaneados."""
    _validar_argumentos(formato, dpi, calidad)
    # pypdf valida primero para reutilizar los mensajes de PDF protegido o dañado.
    total = len(abrir_pdf(datos).pages)
    if paginas is None:
        elegidas = list(range(1, total + 1))
    else:
        elegidas = paginas_de_rangos(interpretar_rangos(paginas, total))
    if len(elegidas) > MAX_PAGINAS_A_IMAGEN:
        raise ErrorLimiteExcedido(
            f"No se pueden convertir más de {MAX_PAGINAS_A_IMAGEN} páginas a imágenes a la vez.",
            'elegí menos páginas con el argumento de páginas, por ejemplo "1-50".',
        )
    escala = dpi / _PUNTOS_POR_PULGADA
    salidas: list[SalidaConversion] = []
    try:
        documento = pdfium.PdfDocument(datos)
    except Exception:
        raise _error_pdfium() from None
    try:
        for numero in elegidas:
            try:
                pagina = documento[numero - 1]
            except Exception:
                raise _error_pdfium() from None
            try:
                ancho_pt, alto_pt = pagina.get_size()
                ancho = math.ceil(ancho_pt * escala)
                alto = math.ceil(alto_pt * escala)
                if ancho * alto > MAX_PIXELES_PAGINA:
                    raise ErrorLimiteExcedido(
                        f"La página {numero} resultaría en una imagen de {ancho}x{alto} píxeles, "
                        f"más de los {MAX_PIXELES_PAGINA:,} píxeles permitidos.",
                        "bajá el valor de dpi.",
                    )
                mapa = pagina.render(scale=escala)
                try:
                    imagen = mapa.to_pil()
                finally:
                    mapa.close()
                try:
                    contenido = _codificar(imagen, formato, calidad)
                finally:
                    imagen.close()
            except ErrorConvertiTodo:
                raise
            except Exception:
                raise _error_pdfium() from None
            finally:
                pagina.close()
            salidas.append(SalidaConversion(f"{nombre_base}-p{numero}.{formato}", contenido))
    finally:
        documento.close()
    return salidas


def imagenes_a_pdf(imagenes: Sequence[bytes], *, titulo: str = "") -> bytes:
    """Una página por imagen, del tamaño de la imagen (1 px = 1 pt, como la app web)."""
    if not imagenes:
        raise ErrorArgumento("No se recibió ninguna imagen.", "indicá al menos una imagen.")
    if len(imagenes) > MAX_IMAGENES_A_PDF:
        raise ErrorLimiteExcedido(
            f"No se pueden combinar más de {MAX_IMAGENES_A_PDF} imágenes en un PDF.",
            f"enviá las imágenes en tandas de hasta {MAX_IMAGENES_A_PDF}.",
        )
    paginas: list[Image.Image] = []
    try:
        for posicion, datos in enumerate(imagenes, start=1):
            try:
                abierta = abrir_imagen(datos)
            except ErrorConvertiTodo as error:
                raise type(error)(
                    f"La imagen número {posicion}: {error.que_fallo}", error.como_corregir
                ) from None
            paginas.append(aplanar_sobre_blanco(abierta))
        salida = io.BytesIO()
        # resolution=72 hace que cada píxel sea un punto, igual que la app web.
        paginas[0].save(
            salida,
            "PDF",
            save_all=True,
            append_images=paginas[1:],
            resolution=float(_PUNTOS_POR_PULGADA),
            title=titulo or None,
        )
        return salida.getvalue()
    finally:
        for pagina in paginas:
            pagina.close()
