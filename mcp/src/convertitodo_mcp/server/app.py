"""Creación de la instancia FastMCP con sus herramientas."""

from __future__ import annotations

from datetime import UTC, datetime

from fastmcp import FastMCP
from mcp.types import ToolAnnotations

from convertitodo_mcp import __version__
from convertitodo_mcp.errores import herramienta_segura
from convertitodo_mcp.server.config import Configuracion

NOMBRE_SERVIDOR = "ConvertiTodo"

INSTRUCCIONES = (
    "Servidor de ConvertiTodo: crea documentos PDF, Word y Excel a partir de Markdown o "
    "bloques estructurados, lee documentos existentes y convierte entre formatos. "
    "Todo el procesamiento ocurre en la máquina del usuario. Usá la herramienta ping para "
    "comprobar que el servidor responde."
)


# Comprueba que el servidor responde y devuelve su nombre, versión y hora UTC.
@herramienta_segura
def ping() -> dict[str, str]:
    return {
        "estado": "ok",
        "servidor": NOMBRE_SERVIDOR,
        "version": __version__,
        "hora": datetime.now(UTC).isoformat(),
    }


# Crea una instancia nueva del servidor con sus herramientas, sin arrancarla ni tocar el disco.
def crear_servidor(config: Configuracion) -> FastMCP:
    servidor = FastMCP(
        NOMBRE_SERVIDOR,
        INSTRUCCIONES,
        version=__version__,
        mask_error_details=True,
    )
    servidor.tool(
        ping,
        name="ping",
        description=(
            "Comprueba que el servidor responde. No recibe argumentos y devuelve el estado "
            "('ok'), el nombre del servidor, su versión y la hora actual en UTC (ISO 8601)."
        ),
        annotations=ToolAnnotations(
            read_only_hint=True, idempotent_hint=True, open_world_hint=False
        ),
    )
    return servidor
