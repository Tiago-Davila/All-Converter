from pathlib import Path
from secrets import token_urlsafe

import pytest
from starlette.testclient import TestClient

from convertitodo_mcp.errores import ErrorConfiguracion
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.cli import _middleware_ui
from convertitodo_mcp.server.config import cargar_configuracion

ORIGEN = "http://127.0.0.1:8080"
TOKEN = token_urlsafe(32)


@pytest.mark.parametrize(
    "origen", ["*", ORIGEN + "/", "http://usuario@localhost", "http://x:65536"]
)
def test_rechaza_origenes_ambiguos(origen: str) -> None:
    with pytest.raises(ErrorConfiguracion):
        cargar_configuracion({"CONVERTITODO_MCP_ORIGEN_UI": origen})


def test_ui_cors_archivos_y_mcp(tmp_path: Path) -> None:
    config = cargar_configuracion(
        {
            "CONVERTITODO_MCP_TRANSPORTE": "http",
            "CONVERTITODO_MCP_WORKDIR": str(tmp_path),
            "CONVERTITODO_MCP_TOKEN": TOKEN,
            "CONVERTITODO_MCP_ORIGEN_UI": ORIGEN,
        }
    )
    assert config.origen_ui == ORIGEN
    app = crear_servidor(config).http_app(
        middleware=_middleware_ui([config.origen_ui]), allowed_origins=[config.origen_ui]
    )
    with TestClient(app, base_url="http://127.0.0.1:8765") as cliente:
        preflight = {
            "Origin": ORIGEN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Mcp-Session-Id, Content-Type",
        }
        for ruta in ("/files", "/mcp"):
            respuesta = cliente.options(ruta, headers=preflight)
            assert respuesta.status_code == 200
            assert respuesta.headers["access-control-allow-origin"] == ORIGEN
            rechazada = cliente.options(ruta, headers={**preflight, "Origin": "http://otro.test"})
            assert rechazada.status_code >= 400
            assert "access-control-allow-origin" not in rechazada.headers
        assert cliente.post("/files", headers={"Origin": ORIGEN}).status_code == 401
        cabeceras = {"Origin": ORIGEN, "Authorization": f"Bearer {TOKEN}"}
        subida = cliente.post(
            "/files", files={"file": ("datos.csv", b"a,b\n1,2")}, headers=cabeceras
        )
        assert subida.status_code == 201
        descarga = cliente.get(subida.json()["url"], headers=cabeceras)
        assert descarga.content == b"a,b\n1,2"
        assert descarga.headers["access-control-allow-origin"] == ORIGEN
        inicio = cliente.post(
            "/mcp",
            headers={**cabeceras, "Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "Prueba UI", "version": "1"},
                },
            },
        )
        assert inicio.status_code == 200
        assert inicio.headers["access-control-allow-origin"] == ORIGEN
        assert inicio.headers["access-control-expose-headers"].lower() == "mcp-session-id"
        assert inicio.headers["mcp-session-id"]
