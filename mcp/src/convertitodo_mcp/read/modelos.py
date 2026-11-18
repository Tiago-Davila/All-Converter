"""Tipos compartidos para la lectura de documentos."""

from dataclasses import dataclass, field
from typing import Literal

TipoDocumento = Literal["pdf", "docx", "xlsx", "pptx", "csv", "html"]


@dataclass(frozen=True, slots=True)
class EntradaDocumento:
    nombre: str
    tipo: TipoDocumento
    datos: bytes


@dataclass(slots=True)
class DocumentoLeido:
    tipo: TipoDocumento
    paginas: list[str]
    hojas: list[str] = field(default_factory=list)


@dataclass(slots=True)
class MetadatosDocumento:
    paginas: int | None = None
    hojas: list[str] = field(default_factory=list)
