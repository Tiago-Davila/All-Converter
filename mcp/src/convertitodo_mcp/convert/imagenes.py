"""Conversión de imágenes PNG/JPG/WebP con calidad y ancho máximo, y apertura segura."""

from __future__ import annotations

import io
import warnings
from typing import Literal

from PIL import Image, ImageOps

from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
)

FormatoImagen = Literal["png", "jpg", "webp"]

MAX_PIXELES = 50_000_000
MAX_LADO = 20_000

_FORMATOS_PILLOW: dict[str, FormatoImagen] = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
_FORMATOS_VALIDOS: tuple[FormatoImagen, ...] = ("png", "jpg", "webp")


# Detecta el formato solo por la firma binaria, sin abrir ni decodificar la imagen.
def detectar_formato_imagen(datos: bytes) -> FormatoImagen | None:
    if datos.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if datos.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(datos) >= 12 and datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "webp"
    return None


# Abre validando firma, formato y dimensiones del encabezado antes de decodificar píxeles.
def _abrir_sin_cargar(datos: bytes) -> Image.Image:
    if not datos:
        raise ErrorFormatoNoSoportado(
            "La imagen está vacía.",
            "Enviá un archivo PNG, JPG o WebP con contenido.",
        )
    if detectar_formato_imagen(datos) is None:
        raise ErrorFormatoNoSoportado(
            "El archivo no es una imagen PNG, JPG o WebP.",
            "Enviá una imagen en alguno de esos tres formatos.",
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            imagen = Image.open(io.BytesIO(datos), formats=["PNG", "JPEG", "WEBP"])
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise _error_dimensiones() from exc
    except Exception as exc:
        raise _error_corrupta() from exc
    ancho, alto = imagen.size
    if ancho < 1 or alto < 1 or ancho > MAX_LADO or alto > MAX_LADO or ancho * alto > MAX_PIXELES:
        imagen.close()
        raise _error_dimensiones()
    return imagen


# Error por dimensiones excesivas (protege contra bombas de descompresión).
def _error_dimensiones() -> ErrorLimiteExcedido:
    return ErrorLimiteExcedido(
        f"La imagen supera el máximo de {MAX_PIXELES // 1_000_000} megapíxeles "
        f"o {MAX_LADO} px por lado.",
        "Reducí la resolución de la imagen antes de enviarla.",
    )


# Error por archivo ilegible, truncado o dañado.
def _error_corrupta() -> ErrorFormatoNoSoportado:
    return ErrorFormatoNoSoportado(
        "No se pudo leer la imagen: está dañada, incompleta o no es válida.",
        "Probá con otra copia del archivo o volvé a exportarla.",
    )


# Decodifica los píxeles, aplica la orientación EXIF y traduce los fallos a errores claros.
def _cargar(imagen: Image.Image) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            imagen.load()
            orientada = ImageOps.exif_transpose(imagen)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise _error_dimensiones() from exc
    except Exception as exc:
        raise _error_corrupta() from exc
    return orientada


# Apertura segura reutilizable: la imagen animada se abre con su primer cuadro.
def abrir_imagen(datos: bytes) -> Image.Image:
    return _cargar(_abrir_sin_cargar(datos))


# Indica si la imagen tiene transparencia (alfa, LA o paleta con transparencia).
def _tiene_alfa(imagen: Image.Image) -> bool:
    return imagen.mode in ("RGBA", "LA", "PA") or "transparency" in imagen.info


# Compone la transparencia sobre blanco y devuelve RGB, igual que la app web al pasar a JPG.
def aplanar_sobre_blanco(imagen: Image.Image) -> Image.Image:
    if not _tiene_alfa(imagen):
        return imagen.convert("RGB")
    rgba = imagen.convert("RGBA")
    fondo = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(fondo, rgba).convert("RGB")


# Valida los argumentos numéricos informando el rango permitido.
def _validar_argumentos(formato: str, calidad: int, ancho_maximo: int | None) -> None:
    if formato not in _FORMATOS_VALIDOS:
        raise ErrorArgumento(
            f"El formato de salida «{formato}» no es válido.",
            "Usá uno de estos valores: png, jpg, webp.",
        )
    if isinstance(calidad, bool) or not isinstance(calidad, int) or not 1 <= calidad <= 100:
        raise ErrorArgumento(
            f"La calidad {calidad!r} está fuera de rango.",
            "Indicá un entero entre 1 y 100.",
        )
    if ancho_maximo is not None and (
        isinstance(ancho_maximo, bool) or not isinstance(ancho_maximo, int) or ancho_maximo < 1
    ):
        raise ErrorArgumento(
            f"El ancho máximo {ancho_maximo!r} no es válido.",
            f"Indicá un entero entre 1 y {MAX_LADO}, o no lo indiques para conservar el ancho.",
        )


# Convierte entre PNG/JPG/WebP; no conserva metadatos (EXIF, GPS ni perfiles ICC) por privacidad.
def convertir_imagen(
    datos: bytes,
    formato: FormatoImagen,
    *,
    calidad: int = 85,
    ancho_maximo: int | None = None,
) -> bytes:
    _validar_argumentos(formato, calidad, ancho_maximo)
    abierta = _abrir_sin_cargar(datos)
    # Igual que la app web: PNG/WebP animados no se convierten como imagen estática.
    if getattr(abierta, "is_animated", False):
        abierta.close()
        raise ErrorFormatoNoSoportado(
            "La imagen es un PNG o WebP animado y no se puede convertir como imagen estática.",
            "Extraé un cuadro como imagen fija y enviá ese archivo.",
        )
    imagen = _cargar(abierta)
    if ancho_maximo is not None and imagen.width > ancho_maximo:
        alto = max(1, round(imagen.height * ancho_maximo / imagen.width))
        imagen = imagen.resize((ancho_maximo, alto), Image.Resampling.LANCZOS)

    salida = io.BytesIO()
    if formato == "jpg":
        aplanar_sobre_blanco(imagen).save(salida, "JPEG", quality=calidad)
    else:
        preparada = imagen.convert("RGBA" if _tiene_alfa(imagen) else "RGB")
        if formato == "png":
            preparada.save(salida, "PNG", optimize=True)
        else:
            preparada.save(salida, "WEBP", quality=calidad)
    return salida.getvalue()
