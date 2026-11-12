"""Pruebas del servidor FastMCP y de su línea de comandos."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from pydantic import SecretStr
from pypdf import PdfReader
from starlette.testclient import TestClient

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
    assert {h.name for h in herramientas} == {"ping", "crear_pdf"}
    ping = next(h for h in herramientas if h.name == "ping")
    assert "Comprueba que el servidor responde" in (ping.description or "")
    assert ping.annotations is not None
    assert ping.annotations.read_only_hint is True


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


@pytest.mark.anyio
async def test_crear_pdf_y_descargar(tmp_path: Path) -> None:
    token = "token-de-prueba-1234567890"  # noqa: S105
    config = Configuracion(carpeta_trabajo=tmp_path, transporte="http", token=SecretStr(token))
    servidor = crear_servidor(config)
    async with Client(servidor) as cliente:
        resultado = await cliente.call_tool(
            "crear_pdf", {"titulo": "Informe", "markdown": "# Hola"}
        )
    datos = resultado.structured_content
    assert datos is not None
    assert datos["nombre"] == "Informe.pdf"
    assert datos["paginas"] == 1
    assert datos["url"] == f"/files/{datos['id']}"
    with TestClient(servidor.http_app()) as http:
        respuesta = http.get(str(datos["url"]), headers={"Authorization": f"Bearer {token}"})
    assert respuesta.status_code == 200
    assert respuesta.content.startswith(b"%PDF")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "argumentos",
    [
        {"titulo": "Informe"},
        {"titulo": "Informe", "markdown": "hola", "bloques": []},
    ],
)
async def test_crear_pdf_exige_una_fuente(tmp_path: Path, argumentos: dict[str, object]) -> None:
    async with Client(crear_servidor(_config(tmp_path))) as cliente:
        with pytest.raises(ToolError, match="exactamente una fuente"):
            await cliente.call_tool("crear_pdf", argumentos)


@pytest.mark.anyio
async def test_crear_pdf_rechaza_limite(tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_bloques=1)
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError, match="máximo permitido"):
            await cliente.call_tool("crear_pdf", {"titulo": "Informe", "markdown": "Uno\n\nDos"})
    assert not list((tmp_path / "outputs").rglob("*.pdf"))


@pytest.mark.anyio
@pytest.mark.parametrize("contenido", [{"markdown": "  "}, {"bloques": []}])
async def test_crear_pdf_rechaza_contenido_vacio(
    tmp_path: Path, contenido: dict[str, object]
) -> None:
    async with Client(crear_servidor(_config(tmp_path))) as cliente:
        with pytest.raises(ToolError, match="contenido del documento está vacío"):
            await cliente.call_tool("crear_pdf", {"titulo": "Informe", **contenido})


@pytest.mark.anyio
async def test_crear_pdf_bloques_imagen_subida_y_descarga(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    token = "token-de-prueba-1234567890"  # noqa: S105
    config = Configuracion(carpeta_trabajo=tmp_path, transporte="http", token=SecretStr(token))
    servidor = crear_servidor(config)
    cabeceras = {"Authorization": f"Bearer {token}"}
    with TestClient(servidor.http_app()) as http:
        subida = http.post(
            "/files?nombre=sample.png", content=fixture_bytes("sample.png"), headers=cabeceras
        )
        assert subida.status_code == 201
        identificador = subida.json()["id"]
        async with Client(servidor) as cliente:
            resultado = await cliente.call_tool(
                "crear_pdf",
                {
                    "titulo": "Con imagen",
                    "bloques": [
                        {"tipo": "parrafo", "texto": "Foto local"},
                        {"tipo": "imagen", "archivo": identificador},
                    ],
                },
            )
        assert resultado.structured_content is not None
        respuesta = http.get(str(resultado.structured_content["url"]), headers=cabeceras)
        assert respuesta.status_code == 200
    pdf = PdfReader(BytesIO(respuesta.content))
    assert "Foto local" in pdf.pages[0].extract_text()
    assert pdf.pages[0].images


@pytest.mark.anyio
@pytest.mark.parametrize(
    "argumentos",
    [
        {"titulo": "X" * (1024 * 1024), "markdown": "texto"},
        {"titulo": "Informe", "bloques": [{"tipo": "tabla", "filas": [["a"], ["b"]]}]},
    ],
)
async def test_crear_pdf_rechaza_limites_texto_y_filas(
    tmp_path: Path, argumentos: dict[str, object]
) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_mb=1, max_filas=1)
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError, match="máximo permitido"):
            await cliente.call_tool("crear_pdf", argumentos)
    assert not list((tmp_path / "outputs").rglob("*.pdf"))


@pytest.mark.anyio
@pytest.mark.parametrize(
    "argumentos",
    [
        {"titulo": "Informe", "markdown": "hola", "opciones": {"tamano": "A3"}},
        {"titulo": "Informe", "bloques": [{"tipo": "imagen", "archivo": "../../secreto"}]},
        {"titulo": "Informe", "bloques": [{"tipo": "imagen", "archivo": "A" * 22}]},
    ],
)
async def test_crear_pdf_rechaza_opciones_e_id_invalidos(
    tmp_path: Path, argumentos: dict[str, object]
) -> None:
    async with Client(crear_servidor(_config(tmp_path))) as cliente:
        with pytest.raises(ToolError) as info:
            await cliente.call_tool("crear_pdf", argumentos)
    assert str(tmp_path) not in str(info.value)
    assert "Traceback" not in str(info.value)


@pytest.mark.anyio
async def test_timeout_no_guarda_salida_tardia(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading

    import anyio

    from convertitodo_mcp.blocks import Bloque
    from convertitodo_mcp.limites import ejecutar_con_limite
    from convertitodo_mcp.render.pdf import OpcionesPDF, renderizar_pdf
    from convertitodo_mcp.server import pdf as herramienta_pdf
    from convertitodo_mcp.storage import Almacen

    liberar = threading.Event()
    terminado = threading.Event()

    def render_lento(
        bloques: Sequence[Bloque],
        opciones: OpcionesPDF | None = None,
        *,
        almacen: Almacen | None = None,
        config: Configuracion | None = None,
    ) -> bytes:
        liberar.wait(3)
        try:
            return renderizar_pdf(bloques, opciones, almacen=almacen, config=config)
        finally:
            terminado.set()

    async def limite_corto[R](funcion: Callable[[], R], segundos: float, *, que: str) -> R:
        return await ejecutar_con_limite(funcion, 0.05, que=que)

    monkeypatch.setattr(herramienta_pdf, "renderizar_pdf", render_lento)
    monkeypatch.setattr(herramienta_pdf, "ejecutar_con_limite", limite_corto)
    config = _config(tmp_path)
    async with Client(crear_servidor(config)) as cliente:
        try:
            with pytest.raises(ToolError, match="tardó más"):
                await cliente.call_tool("crear_pdf", {"titulo": "Lento", "markdown": "Texto"})
        finally:
            liberar.set()
        assert await anyio.to_thread.run_sync(terminado.wait, 3)
    assert not list((config.carpeta_trabajo / "outputs").rglob("*.pdf"))
