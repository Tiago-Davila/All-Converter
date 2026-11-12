"""Pruebas de las herramientas de lectura."""

from collections.abc import Callable
from pathlib import Path

import pytest
from fastmcp.exceptions import ToolError
from pypdf._page import PageObject

from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.server.lectura import crear_herramienta_info
from convertitodo_mcp.storage import Almacen


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_info_documento_metadatos_sin_extraccion(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    def prohibir_extraccion(*args: object, **kwargs: object) -> None:
        raise AssertionError("La consulta de metadatos no debe extraer texto")

    monkeypatch.setattr(PageObject, "extract_text", prohibir_extraccion)
    almacen = Almacen(tmp_path)
    datos = fixture_bytes("text.pdf")
    guardado = almacen.guardar_subida("text.pdf", datos)
    info = crear_herramienta_info(almacen, Configuracion(carpeta_trabajo=tmp_path))
    resultado = await info(guardado.id)
    assert resultado.archivo == guardado.id
    assert resultado.nombre == "text.pdf"
    assert resultado.tipo == "pdf"
    assert resultado.tamano == len(datos)
    assert resultado.paginas is not None and resultado.paginas > 0
    assert resultado.hojas == []


@pytest.mark.anyio
async def test_info_documento_id_inexistente(tmp_path: Path) -> None:
    info = crear_herramienta_info(Almacen(tmp_path), Configuracion(carpeta_trabajo=tmp_path))
    with pytest.raises(ToolError):
        await info("inexistente")
