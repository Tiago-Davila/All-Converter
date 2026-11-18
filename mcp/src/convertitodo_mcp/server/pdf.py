"""Herramienta MCP para crear un PDF localmente."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from io import BytesIO

from pydantic import BaseModel
from pypdf import PdfReader

from convertitodo_mcp.blocks import Bloque, Documento, markdown_a_bloques
from convertitodo_mcp.errores import ErrorArgumento, herramienta_segura
from convertitodo_mcp.limites import ejecutar_con_limite, verificar_bloques, verificar_texto
from convertitodo_mcp.render.pdf import OpcionesPDF, renderizar_pdf
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen
from convertitodo_mcp.storage.rutas import sanear_nombre


class ResultadoPDF(BaseModel):
    id: str
    nombre: str
    paginas: int
    url: str


def crear_herramienta_pdf(
    almacen: Almacen, config: Configuracion
) -> Callable[[str, str | None, list[Bloque] | None, OpcionesPDF | None], Awaitable[ResultadoPDF]]:
    @herramienta_segura
    async def crear_pdf(
        titulo: str,
        markdown: str | None = None,
        bloques: list[Bloque] | None = None,
        opciones: OpcionesPDF | None = None,
    ) -> ResultadoPDF:
        """Crea un PDF local desde Markdown o bloques y devuelve su identificador."""
        if not titulo.strip():
            raise ErrorArgumento("El título está vacío.", "indicá un título para el archivo.")
        if (markdown is None) == (bloques is None):
            raise ErrorArgumento(
                "Indicá exactamente una fuente de contenido.",
                "proporcioná 'markdown' o 'bloques', sin enviar ambos.",
            )
        opciones = opciones or OpcionesPDF()
        entrada = {
            "titulo": titulo,
            "markdown": markdown,
            "bloques": Documento(bloques=bloques).model_dump(mode="json")
            if bloques is not None
            else None,
            "opciones": opciones.model_dump(mode="json"),
        }
        verificar_texto(json.dumps(entrada, ensure_ascii=False), config, que="el contenido")
        if not opciones.titulo:
            opciones = opciones.model_copy(update={"titulo": titulo})

        def generar() -> tuple[bytes, int]:
            contenido = markdown_a_bloques(markdown) if markdown is not None else bloques or []
            if not contenido:
                raise ErrorArgumento(
                    "El contenido del documento está vacío.",
                    "agregá texto Markdown o al menos un bloque con contenido.",
                )
            verificar_bloques(contenido, config)
            datos = renderizar_pdf(contenido, opciones, almacen=almacen, config=config)
            return datos, len(PdfReader(BytesIO(datos)).pages)

        datos, paginas = await ejecutar_con_limite(
            generar, config.timeout_s, que="la creación del PDF"
        )
        guardado = almacen.guardar_salida(sanear_nombre(f"{titulo}.pdf"), datos)
        return ResultadoPDF(
            id=guardado.id, nombre=guardado.nombre, paginas=paginas, url=f"/files/{guardado.id}"
        )

    return crear_pdf
