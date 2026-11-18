"""Tipos compartidos por las conversiones entre formatos."""

from dataclasses import dataclass


# Archivo producido por una conversión: nombre sugerido con extensión y contenido.
@dataclass(frozen=True, slots=True)
class SalidaConversion:
    nombre: str
    datos: bytes
