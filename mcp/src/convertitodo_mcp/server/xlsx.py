"""Herramientas MCP para crear planillas XLSX localmente."""

from __future__ import annotations

import json
from collections.abc import Awaitable
from typing import Protocol

from pydantic import BaseModel

from convertitodo_mcp.blocks.planilla import Hoja, Planilla
from convertitodo_mcp.convert.texto_a_planilla import hoja_desde_csv, hoja_desde_markdown
from convertitodo_mcp.errores import ErrorArgumento, herramienta_segura
from convertitodo_mcp.limites import ejecutar_con_limite, verificar_texto
from convertitodo_mcp.render.xlsx import OpcionesXLSX, renderizar_xlsx
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen
from convertitodo_mcp.storage.rutas import sanear_nombre


class ResultadoXLSX(BaseModel):
    id: str
    nombre: str
    hojas: list[str]
    url: str


class HerramientaXLSX(Protocol):
    def __call__(
        self,
        titulo: str,
        hojas: list[Hoja] | None = None,
        markdown: str | None = None,
        csv: str | None = None,
        opciones: OpcionesXLSX | None = None,
    ) -> Awaitable[ResultadoXLSX]: ...


def validar_titulo(titulo: str) -> None:
    if not titulo.strip():
        raise ErrorArgumento("El título está vacío.", "indicá un título para el archivo.")
    if len(titulo) > 255:
        raise ErrorArgumento("El título supera los 255 caracteres.", "usá un título más corto.")


def crear_herramienta_xlsx(almacen: Almacen, config: Configuracion) -> HerramientaXLSX:
    @herramienta_segura
    async def crear_xlsx(
        titulo: str,
        hojas: list[Hoja] | None = None,
        markdown: str | None = None,
        csv: str | None = None,
        opciones: OpcionesXLSX | None = None,
    ) -> ResultadoXLSX:
        """Crea un XLSX local desde hojas tipadas, una tabla Markdown o un CSV."""
        validar_titulo(titulo)
        if sum(fuente is not None for fuente in (hojas, markdown, csv)) != 1:
            raise ErrorArgumento(
                "Indicá exactamente una fuente de contenido.",
                "proporcioná 'hojas', 'markdown' o 'csv', sin combinarlos.",
            )
        opciones = opciones or OpcionesXLSX()
        entrada = {
            "titulo": titulo,
            "hojas": [hoja.model_dump(mode="json") for hoja in hojas or []],
            "markdown": markdown,
            "csv": csv,
            "opciones": opciones.model_dump(mode="json"),
        }
        verificar_texto(json.dumps(entrada, ensure_ascii=False), config, que="el contenido")

        def generar() -> tuple[bytes, list[str]]:
            if markdown is not None:
                contenido = [hoja_desde_markdown(markdown)]
            elif csv is not None:
                contenido = [hoja_desde_csv(csv)]
            else:
                contenido = hojas or []
            if not contenido:
                raise ErrorArgumento(
                    "La planilla no tiene hojas.", "agregá al menos una hoja en 'hojas'."
                )
            planilla = Planilla(hojas=contenido)
            nombres = [hoja.nombre for hoja in planilla.hojas]
            return renderizar_xlsx(planilla, config, opciones), nombres

        datos, nombres = await ejecutar_con_limite(
            generar, config.timeout_s, que="la creación del XLSX"
        )
        guardado = almacen.guardar_salida(sanear_nombre(f"{titulo}.xlsx"), datos)
        return ResultadoXLSX(
            id=guardado.id, nombre=guardado.nombre, hojas=nombres, url=f"/files/{guardado.id}"
        )

    return crear_xlsx
