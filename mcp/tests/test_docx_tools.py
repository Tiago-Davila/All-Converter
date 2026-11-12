"""Pruebas de la herramienta de creación DOCX."""

from io import BytesIO
from pathlib import Path
from threading import Event

import anyio
import pytest
from docx import Document
from fastmcp.exceptions import ToolError

from convertitodo_mcp.blocks import Documento
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.server.docx import crear_herramienta_docx
from convertitodo_mcp.storage import Almacen


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_crear_docx_markdown_y_bloques(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    crear = crear_herramienta_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    bloques = Documento.model_validate({"bloques": [{"tipo": "parrafo", "texto": "Segundo"}]})
    for resultado, texto in (
        (await crear("Informe", markdown="# Primero"), "Primero"),
        (await crear("Otro", bloques=bloques.bloques), "Segundo"),
    ):
        assert resultado.nombre.endswith(".docx")
        assert resultado.url == f"/files/{resultado.id}"
        documento = Document(BytesIO(almacen.leer(resultado.id)))
        assert any(texto in parrafo.text for parrafo in documento.paragraphs)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "titulo,markdown,bloques",
    [
        ("", "Texto", None),
        ("T" * 256, "Texto", None),
        ("Título", None, None),
        ("Título", "Texto", []),
        ("Título", "   ", None),
        ("Título", None, []),
    ],
)
async def test_crear_docx_rechaza_entrada_invalida(
    tmp_path: Path, titulo: str, markdown: str | None, bloques: list[object] | None
) -> None:
    almacen = Almacen(tmp_path)
    crear = crear_herramienta_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    # Los únicos valores de bloques de este caso son None y una lista vacía.
    with pytest.raises(ToolError):
        await crear(titulo, markdown=markdown, bloques=[] if bloques is not None else None)
    assert almacen.listar("outputs") == []


@pytest.mark.anyio
async def test_crear_docx_aplica_limites(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path, max_bloques=1, max_filas=1)
    crear = crear_herramienta_docx(almacen, config)
    with pytest.raises(ToolError, match="bloques"):
        await crear("Título", markdown="Uno\n\nDos")
    tabla = Documento.model_validate({"bloques": [{"tipo": "tabla", "filas": [["a"], ["b"]]}]})
    crear_filas = crear_herramienta_docx(almacen, config.model_copy(update={"max_bloques": 10}))
    with pytest.raises(ToolError, match="filas"):
        await crear_filas("Título", bloques=tabla.bloques)
    crear_bytes = crear_herramienta_docx(almacen, config.model_copy(update={"max_mb": 0}))
    with pytest.raises(ToolError, match="máximo"):
        await crear_bytes("Título", markdown="Texto")
    assert almacen.listar("outputs") == []


@pytest.mark.anyio
async def test_timeout_no_guarda_salida_tardia(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import convertitodo_mcp.server.docx as modulo

    inicio, continuar, terminado = Event(), Event(), Event()

    def render_lento(*args: object, **kwargs: object) -> bytes:
        inicio.set()
        continuar.wait(3)
        terminado.set()
        return b"resultado tardio"

    monkeypatch.setattr(modulo, "renderizar_docx", render_lento)
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path, timeout_s=1)
    crear = crear_herramienta_docx(almacen, config)
    try:
        with pytest.raises(ToolError, match="canceló"):
            await crear("Título", markdown="Texto")
        assert inicio.is_set()
    finally:
        continuar.set()
    assert await anyio.to_thread.run_sync(terminado.wait, 3)
    assert almacen.listar("outputs") == []
