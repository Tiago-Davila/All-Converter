"""Creación de la instancia FastMCP con sus herramientas."""

from __future__ import annotations

from datetime import UTC, datetime

from fastmcp import FastMCP
from mcp.types import ToolAnnotations

from convertitodo_mcp import __version__
from convertitodo_mcp.errores import herramienta_segura
from convertitodo_mcp.server.archivos_http import registrar_rutas_de_archivos
from convertitodo_mcp.server.auth import crear_verificador
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.server.docx import crear_herramienta_docx, crear_herramienta_editar_docx
from convertitodo_mcp.server.lectura import crear_herramienta_info
from convertitodo_mcp.server.pdf import crear_herramienta_pdf
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.limpieza import crear_ciclo_de_vida

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
    almacen = Almacen(config.carpeta_trabajo)
    servidor = FastMCP(
        NOMBRE_SERVIDOR,
        INSTRUCCIONES,
        version=__version__,
        mask_error_details=True,
        auth=crear_verificador(config),
        lifespan=crear_ciclo_de_vida(almacen, config),
    )
    registrar_rutas_de_archivos(servidor, almacen, config)
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
    servidor.tool(
        crear_herramienta_pdf(almacen, config),
        name="crear_pdf",
        description=(
            "Crea un PDF local. Indicá titulo y exactamente uno de markdown o bloques; "
            "opciones permite tamaño, orientación, márgenes en mm, metadatos y numeración. "
            "Devuelve id, nombre, páginas y URL relativa de descarga."
        ),
        annotations=ToolAnnotations(
            read_only_hint=False, idempotent_hint=False, open_world_hint=False
        ),
    )
    servidor.tool(
        crear_herramienta_docx(almacen, config),
        name="crear_docx",
        description=(
            "Crea un Word editable local. Indicá titulo y exactamente uno de markdown o bloques. "
            "opciones permite tamaño, orientación, márgenes en mm, tabla_contenido y plantilla "
            "por id de archivo subido. Devuelve id, nombre y URL relativa de descarga."
        ),
        annotations=ToolAnnotations(
            read_only_hint=False, idempotent_hint=False, open_world_hint=False
        ),
    )
    servidor.tool(
        crear_herramienta_editar_docx(almacen, config),
        name="editar_docx",
        description=(
            "Edita una copia de un Word por archivo (id). operaciones admite agregar_seccion "
            "(titulo, nivel, bloques), reemplazar_texto (buscar, reemplazo literal dentro de cada "
            "párrafo) y agregar_tabla (tabla). Conserva el original; devuelve id, nombre y URL."
        ),
        annotations=ToolAnnotations(
            read_only_hint=False, idempotent_hint=False, open_world_hint=False
        ),
    )
    servidor.tool(
        crear_herramienta_info(almacen, config),
        name="info_documento",
        description=(
            "Consulta primero tipo, tamaño en bytes, páginas o diapositivas y nombres de hojas "
            "por archivo (id). No extrae todo el texto. Las páginas de Word/CSV/HTML se "
            "devuelven como null porque no tienen paginación física fiable."
        ),
        annotations=ToolAnnotations(
            read_only_hint=True, idempotent_hint=True, open_world_hint=False
        ),
    )
    return servidor
