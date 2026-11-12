"""Herramientas MCP para consultar documentos locales."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Protocol

from pydantic import BaseModel

from convertitodo_mcp.errores import ErrorArgumento, herramienta_segura
from convertitodo_mcp.limites import ejecutar_con_limite
from convertitodo_mcp.read.deteccion import cargar_entrada
from convertitodo_mcp.read.markitdown import leer_markitdown
from convertitodo_mcp.read.modelos import TipoDocumento
from convertitodo_mcp.read.paginacion import paginar_documento
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


class ResultadoLectura(BaseModel):
    archivo: str
    tipo: TipoDocumento
    pagina: int
    total_paginas: int
    origen: int
    nombre_hoja: str | None
    contenido: str
    siguiente_pagina: int | None


class HerramientaLeerDocumento(Protocol):
    def __call__(
        self, archivo: str, pagina: int = 1, max_caracteres: int = 8000
    ) -> Awaitable[ResultadoLectura]: ...


def crear_herramienta_leer(almacen: Almacen, config: Configuracion) -> HerramientaLeerDocumento:
    @herramienta_segura
    async def leer_documento(
        archivo: str, pagina: int = 1, max_caracteres: int = 8000
    ) -> ResultadoLectura:
        """Lee una página virtual de un documento local."""
        if pagina < 1:
            raise ErrorArgumento("La página debe ser mayor que cero.", "indicá una página válida.")
        if not 1 <= max_caracteres <= 20000:
            raise ErrorArgumento(
                "El límite de caracteres debe estar entre 1 y 20000.",
                "indicá un valor dentro de ese rango.",
            )

        def consultar() -> ResultadoLectura:
            entrada = cargar_entrada(archivo, almacen, config)
            documento = leer_markitdown(entrada, config)
            resultado = paginar_documento(
                documento, pagina, max_caracteres, max_bytes=config.max_bytes
            )
            return ResultadoLectura(
                archivo=archivo,
                tipo=documento.tipo,
                pagina=resultado.numero,
                total_paginas=resultado.total_paginas,
                origen=resultado.origen,
                nombre_hoja=resultado.nombre_hoja,
                contenido=resultado.contenido,
                siguiente_pagina=resultado.siguiente,
            )

        return await ejecutar_con_limite(
            consultar, config.timeout_s, que="la lectura del documento"
        )

    return leer_documento
