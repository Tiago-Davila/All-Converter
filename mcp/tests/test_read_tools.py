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


@pytest.mark.anyio
@pytest.mark.parametrize("nombre", ["text.pdf", "sample.docx"])
async def test_leer_documento_paginas_sin_perdida(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], nombre: str
) -> None:
    from convertitodo_mcp.server.lectura import crear_herramienta_leer

    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path)
    datos = fixture_bytes(nombre)
    guardado = almacen.guardar_subida(nombre, datos)
    leer = crear_herramienta_leer(almacen, config)
    completa = await leer(guardado.id, max_caracteres=20000)
    primera = await leer(guardado.id, 1, 7)
    segunda = await leer(guardado.id, 2, 7)
    assert primera.contenido + segunda.contenido == completa.contenido[:14]
    assert primera.origen == segunda.origen == completa.origen == 1
    assert primera.siguiente_pagina == 2
    assert segunda.pagina == 2
    assert almacen.leer(guardado.id) == datos


@pytest.mark.anyio
async def test_leer_valida_antes_de_cargar(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from convertitodo_mcp.server import lectura

    def prohibir_carga(*args: object, **kwargs: object) -> None:
        raise AssertionError("No debe cargar el archivo con argumentos inválidos")

    monkeypatch.setattr(lectura, "cargar_entrada", prohibir_carga)
    leer = lectura.crear_herramienta_leer(
        Almacen(tmp_path), Configuracion(carpeta_trabajo=tmp_path)
    )
    for pagina, max_caracteres in [(0, 1), (1, 0), (1, 20001)]:
        with pytest.raises(ToolError, match="página|caracteres"):
            await leer("id", pagina, max_caracteres)
