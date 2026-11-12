"""Herramientas MCP para consultar documentos locales."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Protocol

from pydantic import BaseModel

from convertitodo_mcp.errores import herramienta_segura
from convertitodo_mcp.limites import ejecutar_con_limite
from convertitodo_mcp.read.deteccion import cargar_entrada
from convertitodo_mcp.read.modelos import TipoDocumento
from convertitodo_mcp.read.respaldo import info_basica
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


class ResultadoInfoDocumento(BaseModel):
    archivo: str
    nombre: str
    tipo: TipoDocumento
    tamano: int
    paginas: int | None
    hojas: list[str]


class HerramientaInfoDocumento(Protocol):
    def __call__(self, archivo: str) -> Awaitable[ResultadoInfoDocumento]: ...


def crear_herramienta_info(almacen: Almacen, config: Configuracion) -> HerramientaInfoDocumento:
    @herramienta_segura
    async def info_documento(archivo: str) -> ResultadoInfoDocumento:
        """Consulta los metadatos básicos de un documento local."""

        def consultar() -> ResultadoInfoDocumento:
            entrada = cargar_entrada(archivo, almacen, config)
            metadata = info_basica(entrada, config)
            return ResultadoInfoDocumento(
                archivo=archivo,
                nombre=entrada.nombre,
                tipo=entrada.tipo,
                tamano=len(entrada.datos),
                paginas=metadata.paginas,
                hojas=metadata.hojas,
            )

        return await ejecutar_con_limite(
            consultar, config.timeout_s, que="la consulta del documento"
        )

    return info_documento
