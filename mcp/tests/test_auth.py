"""Pruebas del token Bearer obligatorio en el transporte HTTP."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import SecretStr
from starlette.requests import Request
from starlette.testclient import TestClient

from convertitodo_mcp.errores import ErrorConfiguracion
from convertitodo_mcp.server import cli
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.auth import (
    crear_verificador,
    peticion_autorizada,
    respuesta_no_autorizada,
    validar_arranque,
)
from convertitodo_mcp.server.config import Configuracion

TOKEN = "token-de-prueba-1234567890"  # noqa: S105
_ABIERTO = "0.0.0.0"  # noqa: S104
_INICIAR = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "prueba", "version": "1"},
    },
}
_CABECERAS = {"Accept": "application/json, text/event-stream"}


# Configuración de prueba con transporte, host y token opcionales.
def _config(
    tmp_path: Path, transporte: str = "http", host: str = "127.0.0.1", token: str | None = TOKEN
) -> Configuracion:
    return Configuracion.model_validate(
        {
            "transporte": transporte,
            "host": host,
            "token": None if token is None else SecretStr(token),
            "carpeta_trabajo": tmp_path / "trabajo",
        }
    )


# Arma una Request de starlette con las cabeceras indicadas.
def _peticion(cabeceras: dict[str, str]) -> Request:
    crudas = [(k.lower().encode(), v.encode()) for k, v in cabeceras.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": crudas})


# Envía un initialize al endpoint MCP con las cabeceras de autorización dadas.
def _iniciar(config: Configuracion, autorizacion: str | None) -> int:
    cabeceras = dict(_CABECERAS)
    if autorizacion is not None:
        cabeceras["Authorization"] = autorizacion
    with TestClient(crear_servidor(config).http_app()) as cliente:
        return cliente.post("/mcp", json=_INICIAR, headers=cabeceras).status_code


# stdio nunca exige token.
def test_stdio_sin_token_pasa(tmp_path: Path) -> None:
    validar_arranque(_config(tmp_path, transporte="stdio", token=None))


# HTTP sin token falla en loopback y nombra la variable.
def test_http_sin_token_falla_en_loopback(tmp_path: Path) -> None:
    with pytest.raises(ErrorConfiguracion) as info:
        validar_arranque(_config(tmp_path, token=None))
    mensaje = str(info.value)
    assert "CONVERTITODO_MCP_TOKEN" in mensaje
    assert "secrets.token_urlsafe" in mensaje
    assert "se expone" not in info.value.que_fallo


# HTTP sin token en 0.0.0.0 falla y avisa de la exposición a la red.
def test_http_sin_token_falla_en_host_abierto(tmp_path: Path) -> None:
    with pytest.raises(ErrorConfiguracion) as info:
        validar_arranque(_config(tmp_path, host=_ABIERTO, token=None))
    mensaje = str(info.value)
    assert "CONVERTITODO_MCP_TOKEN" in mensaje
    assert "nunca se expone el servidor a la red sin token" in mensaje


# HTTP con token pasa tanto en loopback como en host abierto.
def test_http_con_token_pasa(tmp_path: Path) -> None:
    validar_arranque(_config(tmp_path))
    validar_arranque(_config(tmp_path, host=_ABIERTO))


# El verificador no expone el token en su repr y no existe sin token.
def test_verificador_sin_fugas(tmp_path: Path) -> None:
    verificador = crear_verificador(_config(tmp_path))
    assert verificador is not None
    assert TOKEN not in repr(verificador)
    assert crear_verificador(_config(tmp_path, token=None)) is None


# main con HTTP sin token devuelve 2, escribe en español y no levanta nada.
def test_main_http_sin_token(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.delenv("CONVERTITODO_MCP_TOKEN", raising=False)
    monkeypatch.setenv("CONVERTITODO_MCP_WORKDIR", str(tmp_path))

    def _no_debe_llamarse(config: Configuracion) -> None:
        raise AssertionError("no debería crearse el servidor")

    monkeypatch.setattr(cli, "crear_servidor", _no_debe_llamarse)
    assert cli.main(["--transporte", "http"]) == 2
    err = capsys.readouterr().err
    assert "CONVERTITODO_MCP_TOKEN" in err
    assert "Cómo corregirlo" in err
    assert "Traceback" not in err


# Sin cabecera Authorization el endpoint MCP responde 401.
def test_mcp_sin_cabecera(tmp_path: Path) -> None:
    assert _iniciar(_config(tmp_path), None) == 401


# Con un token incorrecto el endpoint MCP responde 401.
def test_mcp_token_incorrecto(tmp_path: Path) -> None:
    assert _iniciar(_config(tmp_path), "Bearer otro-token-incorrecto") == 401


# Con un esquema distinto de Bearer el endpoint MCP responde 401.
def test_mcp_esquema_incorrecto(tmp_path: Path) -> None:
    assert _iniciar(_config(tmp_path), f"Basic {TOKEN}") == 401


# Con el token correcto el endpoint MCP atiende el initialize.
def test_mcp_token_correcto(tmp_path: Path) -> None:
    assert _iniciar(_config(tmp_path), f"Bearer {TOKEN}") == 200


# Las rutas propias comprueban la cabecera con peticion_autorizada.
def test_peticion_autorizada(tmp_path: Path) -> None:
    config = _config(tmp_path)
    assert not peticion_autorizada(_peticion({}), config)
    assert peticion_autorizada(_peticion({"Authorization": f"Bearer {TOKEN}"}), config)
    assert peticion_autorizada(_peticion({"Authorization": f"bearer {TOKEN}"}), config)
    assert not peticion_autorizada(_peticion({"Authorization": "Bearer incorrecto"}), config)
    assert not peticion_autorizada(_peticion({"Authorization": f"Bearer  {TOKEN}"}), config)
    assert not peticion_autorizada(_peticion({"Authorization": f"Basic {TOKEN}"}), config)
    assert not peticion_autorizada(_peticion({"Authorization": TOKEN}), config)


# Sin token configurado ninguna petición está autorizada.
def test_peticion_sin_token_configurado(tmp_path: Path) -> None:
    config = _config(tmp_path, token=None)
    assert not peticion_autorizada(_peticion({"Authorization": f"Bearer {TOKEN}"}), config)
    assert not peticion_autorizada(_peticion({"Authorization": "Bearer "}), config)


# La respuesta 401 trae WWW-Authenticate y un cuerpo JSON en español.
def test_respuesta_no_autorizada() -> None:
    respuesta = respuesta_no_autorizada()
    assert respuesta.status_code == 401
    assert respuesta.headers["www-authenticate"] == "Bearer"
    assert b'"no_autorizado"' in respuesta.body
    assert b"Authorization: Bearer" in respuesta.body
