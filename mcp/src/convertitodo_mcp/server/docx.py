"""Herramienta MCP para crear un DOCX localmente."""

from __future__ import annotations

import json
from typing import Protocol

from pydantic import BaseModel

from convertitodo_mcp.blocks import Bloque, Documento, markdown_a_bloques
from convertitodo_mcp.errores import ErrorArgumento, herramienta_segura
from convertitodo_mcp.errores import ErrorLimiteExcedido
from convertitodo_mcp.limites import ejecutar_con_limite, verificar_bloques, verificar_texto
from convertitodo_mcp.render.docx import renderizar_docx
from convertitodo_mcp.render.docx_edit import OperacionDOCX, bloques_operaciones, editar_documento
from convertitodo_mcp.render.docx_layout import OpcionesDOCX, cargar_documento
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen
from convertitodo_mcp.storage.rutas import sanear_nombre


class ResultadoDOCX(BaseModel):
    id: str
    nombre: str
    url: str


class HerramientaDOCX(Protocol):
    async def __call__(
        self,
        titulo: str,
        markdown: str | None = None,
        bloques: list[Bloque] | None = None,
        opciones: OpcionesDOCX | None = None,
    ) -> ResultadoDOCX: ...


def crear_herramienta_docx(almacen: Almacen, config: Configuracion) -> HerramientaDOCX:
    @herramienta_segura
    async def crear_docx(
        titulo: str,
        markdown: str | None = None,
        bloques: list[Bloque] | None = None,
        opciones: OpcionesDOCX | None = None,
    ) -> ResultadoDOCX:
        """Crea un DOCX local desde Markdown o bloques y devuelve su identificador."""
        if not titulo.strip():
            raise ErrorArgumento("El título está vacío.", "indicá un título para el archivo.")
        if len(titulo) > 255:
            raise ErrorArgumento("El título supera los 255 caracteres.", "usá un título más corto.")
        if (markdown is None) == (bloques is None):
            raise ErrorArgumento(
                "Indicá exactamente una fuente de contenido.",
                "proporcioná 'markdown' o 'bloques', sin enviar ambos.",
            )
        opciones = opciones or OpcionesDOCX()
        entrada = {
            "titulo": titulo,
            "markdown": markdown,
            "bloques": Documento(bloques=bloques).model_dump(mode="json")
            if bloques is not None
            else None,
            "opciones": opciones.model_dump(mode="json"),
        }
        verificar_texto(json.dumps(entrada, ensure_ascii=False), config, que="el contenido")

        def generar() -> bytes:
            contenido = markdown_a_bloques(markdown) if markdown is not None else bloques or []
            if not contenido:
                raise ErrorArgumento(
                    "El contenido del documento está vacío.",
                    "agregá texto Markdown o al menos un bloque con contenido.",
                )
            verificar_bloques(contenido, config)
            return renderizar_docx(
                contenido, opciones, almacen=almacen, config=config, titulo=titulo
            )

        datos = await ejecutar_con_limite(generar, config.timeout_s, que="la creación del DOCX")
        guardado = almacen.guardar_salida(sanear_nombre(f"{titulo}.docx"), datos)
        return ResultadoDOCX(id=guardado.id, nombre=guardado.nombre, url=f"/files/{guardado.id}")

    return crear_docx


class HerramientaEditarDOCX(Protocol):
    async def __call__(self, archivo: str, operaciones: list[OperacionDOCX]) -> ResultadoDOCX: ...


def crear_herramienta_editar_docx(almacen: Almacen, config: Configuracion) -> HerramientaEditarDOCX:
    @herramienta_segura
    async def editar_docx(archivo: str, operaciones: list[OperacionDOCX]) -> ResultadoDOCX:
        """Edita una copia de un DOCX; reemplaza texto dentro de cada párrafo."""
        if not operaciones:
            raise ErrorArgumento("No se indicaron operaciones.", "agregá al menos una operación.")
        if len(operaciones) > config.max_bloques:
            raise ErrorLimiteExcedido(
                "La cantidad de operaciones supera el máximo de bloques permitido.",
                "dividí las operaciones en varias llamadas.",
            )
        entrada = [operacion.model_dump(mode="json") for operacion in operaciones]
        verificar_texto(
            json.dumps({"archivo": archivo, "operaciones": entrada}, ensure_ascii=False),
            config,
            que="el contenido",
        )
        verificar_bloques(bloques_operaciones(operaciones), config)

        def generar() -> bytes:
            documento = cargar_documento(archivo, almacen, config)
            return editar_documento(documento, operaciones, almacen=almacen, config=config)

        datos = await ejecutar_con_limite(generar, config.timeout_s, que="la edición del DOCX")
        original = almacen.obtener(archivo)
        nombre = sanear_nombre(f"{original.ruta.stem}-editado.docx")
        guardado = almacen.guardar_salida(nombre, datos)
        return ResultadoDOCX(id=guardado.id, nombre=guardado.nombre, url=f"/files/{guardado.id}")

    return editar_docx
