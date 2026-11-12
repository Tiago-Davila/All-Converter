"""Pruebas del servidor FastMCP y de su línea de comandos."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from fastmcp import Client

from convertitodo_mcp import __version__
from convertitodo_mcp.server import cli
from convertitodo_mcp.server.app import NOMBRE_SERVIDOR, crear_servidor
from convertitodo_mcp.server.config import Configuracion, cargar_configuracion


# Backend asíncrono único para anyio.
@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Configuración mínima que usa tmp_path como carpeta de trabajo.
def _config(tmp_path: Path) -> Configuracion:
    return Configuracion(carpeta_trabajo=tmp_path / "trabajo")


# ping aparece listada con descripción en español y de solo lectura.
@pytest.mark.anyio
async def test_ping_listada(tmp_path: Path) -> None:
    async with Client(crear_servidor(_config(tmp_path))) as cliente:
        herramientas = await cliente.list_tools()
    assert [h.name for h in herramientas] == ["ping"]
    assert "Comprueba que el servidor responde" in (herramientas[0].description or "")
    assert herramientas[0].annotations is not None
    assert herramientas[0].annotations.read_only_hint is True


# ping devuelve estado ok, servidor, versión y hora ISO 8601 parseable.
@pytest.mark.anyio
async def test_ping_responde(tmp_path: Path) -> None:
    async with Client(crear_servidor(_config(tmp_path))) as cliente:
        resultado = await cliente.call_tool("ping")
    datos = resultado.structured_content
    assert datos is not None
    assert datos["estado"] == "ok"
    assert datos["servidor"] == NOMBRE_SERVIDOR
    assert datos["version"] == __version__
    assert datetime.fromisoformat(datos["hora"]).utcoffset() is not None


# crear_servidor devuelve una instancia nueva y no crea archivos.
def test_crear_servidor_sin_efectos(tmp_path: Path) -> None:
    config = _config(tmp_path)
    assert crear_servidor(config) is not crear_servidor(config)
    assert not config.carpeta_trabajo.exists()
    assert list(tmp_path.iterdir()) == []


# La app ASGI de HTTP se construye sin levantarse.
def test_app_http_construible(tmp_path: Path) -> None:
    assert crear_servidor(_config(tmp_path)).http_app() is not None


# --version imprime la versión y devuelve 0.
def test_main_version(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["--version"]) == 0
    assert __version__ in capsys.readouterr().out


# Una configuración inválida devuelve 2 con mensaje en español y sin traceback.
def test_main_configuracion_invalida(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("CONVERTITODO_MCP_PORT", "abc")
    assert cli.main([]) == 2
    err = capsys.readouterr().err
    assert "CONVERTITODO_MCP_PORT" in err
    assert "Cómo corregirlo" in err
    assert "Traceback" not in err


# Un puerto inválido por argumento también devuelve 2 sin traceback.
def test_main_puerto_invalido_por_argumento(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "ejecutar", lambda config: None)
    assert cli.main(["--puerto", "70000"]) == 2
    assert "Traceback" not in capsys.readouterr().err


# Los argumentos pisan lo que viene del entorno.
def test_main_argumentos_pisan_entorno(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CONVERTITODO_MCP_TRANSPORTE", "stdio")
    monkeypatch.setenv("CONVERTITODO_MCP_PORT", "8000")
    monkeypatch.setenv("CONVERTITODO_MCP_WORKDIR", str(tmp_path))
    recibidas: list[Configuracion] = []
    monkeypatch.setattr(cli, "ejecutar", recibidas.append)
    assert cli.main(["--transporte", "http", "--puerto", "9000", "--host", "0.0.0.0"]) == 0  # noqa: S104
    assert len(recibidas) == 1
    assert recibidas[0].transporte == "http"
    assert recibidas[0].puerto == 9000
    assert recibidas[0].host == "0.0.0.0"  # noqa: S104
    assert recibidas[0].carpeta_trabajo == tmp_path


# Sin argumentos se usa la configuración del entorno tal cual.
def test_main_sin_argumentos(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CONVERTITODO_MCP_WORKDIR", str(tmp_path))
    recibidas: list[Configuracion] = []
    monkeypatch.setattr(cli, "ejecutar", recibidas.append)
    assert cli.main([]) == 0
    assert recibidas == [cargar_configuracion()]


# Ctrl+C termina de forma limpia con 0.
def test_main_interrupcion(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CONVERTITODO_MCP_WORKDIR", str(tmp_path))

    def _interrumpir(config: Configuracion) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(cli, "ejecutar", _interrumpir)
    assert cli.main([]) == 0
