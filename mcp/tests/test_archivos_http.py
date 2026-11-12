"""Pruebas de los endpoints HTTP para subir y descargar archivos."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from pydantic import SecretStr
from starlette.testclient import TestClient

from convertitodo_mcp.errores import (
    ErrorArchivoNoEncontrado,
    ErrorArgumento,
    ErrorLimiteExcedido,
    ErrorNoAutorizado,
    ErrorRutaInsegura,
    ErrorTiempoAgotado,
)
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.archivos_http import estado_http
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.rutas import es_id_valido

TOKEN = "token-de-prueba-1234567890"  # noqa: S105
_AUTORIZACION = {"Authorization": f"Bearer {TOKEN}"}
_MB = 1024 * 1024


# Configuración de prueba con tope de 1 MB y carpeta de trabajo dentro de tmp_path.
def _config(tmp_path: Path) -> Configuracion:
    return Configuracion.model_validate(
        {
            "transporte": "http",
            "token": SecretStr(TOKEN),
            "carpeta_trabajo": tmp_path / "trabajo",
            "max_mb": 1,
        }
    )


# Cliente HTTP en memoria con el lifespan activo.
@pytest.fixture
def cliente(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(crear_servidor(_config(tmp_path)).http_app()) as c:
        yield c


# Lista los archivos regulares que hay dentro de una zona.
def _archivos(tmp_path: Path, zona: str) -> list[Path]:
    return [p for p in (tmp_path / "trabajo" / zona).rglob("*") if p.is_file()]


# Verifica que un cuerpo de error es JSON del formato acordado y sin datos internos.
def _verificar_error(respuesta_json: dict[str, str], codigo: str, tmp_path: Path) -> None:
    assert respuesta_json["error"] == codigo
    assert respuesta_json["mensaje"]
    assert str(tmp_path) not in str(respuesta_json)
    assert TOKEN not in str(respuesta_json)


# Sin cabecera, con token incorrecto o con esquema Basic, POST y GET responden 401.
@pytest.mark.parametrize(
    "cabeceras",
    [{}, {"Authorization": "Bearer otro-token-incorrecto"}, {"Authorization": f"Basic {TOKEN}"}],
)
def test_sin_autorizacion(cliente: TestClient, tmp_path: Path, cabeceras: dict[str, str]) -> None:
    subida = cliente.post("/files?nombre=a.txt", content=b"secreto", headers=cabeceras)
    descarga = cliente.get("/files/" + "a" * 22, headers=cabeceras)
    for respuesta in (subida, descarga):
        assert respuesta.status_code == 401
        _verificar_error(respuesta.json(), "no_autorizado", tmp_path)
    assert _archivos(tmp_path, "uploads") == []


# La subida cruda y la descarga devuelven los mismos bytes con las cabeceras esperadas.
@pytest.mark.parametrize(
    ("fixture", "tipo"), [("sample.png", "image/png"), ("text.pdf", "application/pdf")]
)
def test_subida_cruda_y_descarga(
    cliente: TestClient,
    tmp_path: Path,
    fixture_bytes: Callable[[str], bytes],
    fixture: str,
    tipo: str,
) -> None:
    datos = fixture_bytes(fixture)
    subida = cliente.post(f"/files?nombre={fixture}", content=datos, headers=_AUTORIZACION)
    assert subida.status_code == 201
    cuerpo = subida.json()
    assert es_id_valido(cuerpo["id"])
    assert cuerpo["nombre"] == fixture
    assert cuerpo["tamano"] == len(datos)
    assert cuerpo["url"] == f"/files/{cuerpo['id']}"
    assert [p.name for p in _archivos(tmp_path, "uploads")] == [fixture]
    descarga = cliente.get(cuerpo["url"], headers=_AUTORIZACION)
    assert descarga.status_code == 200
    assert descarga.content == datos
    assert descarga.headers["content-type"] == tipo
    assert descarga.headers["content-disposition"].startswith("attachment;")
    assert descarga.headers["x-content-type-options"] == "nosniff"


# La subida multipart acepta los campos file y archivo y devuelve los mismos bytes.
@pytest.mark.parametrize("campo", ["file", "archivo"])
def test_subida_multipart(
    cliente: TestClient, fixture_bytes: Callable[[str], bytes], campo: str
) -> None:
    datos = fixture_bytes("sample.png")
    subida = cliente.post(
        "/files", files={campo: ("foto.png", datos, "image/png")}, headers=_AUTORIZACION
    )
    assert subida.status_code == 201
    assert subida.json()["nombre"] == "foto.png"
    descarga = cliente.get(subida.json()["url"], headers=_AUTORIZACION)
    assert descarga.content == datos
    assert descarga.headers["content-type"] == "image/png"


# El parámetro filename y la ausencia de nombre también funcionan en la subida cruda.
def test_nombre_alternativo_y_por_defecto(cliente: TestClient) -> None:
    uno = cliente.post("/files?filename=nota.txt", content=b"hola", headers=_AUTORIZACION)
    dos = cliente.post("/files", content=b"hola", headers=_AUTORIZACION)
    assert uno.json()["nombre"] == "nota.txt"
    assert dos.json()["nombre"] == "archivo"
    descarga = cliente.get(dos.json()["url"], headers=_AUTORIZACION)
    assert descarga.headers["content-type"] == "application/octet-stream"


# Un nombre hostil se sanea y nada se escribe fuera de la carpeta de trabajo.
@pytest.mark.parametrize("modo", ["cruda", "multipart"])
def test_nombre_hostil(cliente: TestClient, tmp_path: Path, modo: str) -> None:
    hostil = "../../etc/passwd"
    if modo == "cruda":
        subida = cliente.post(
            "/files", params={"nombre": hostil}, content=b"x", headers=_AUTORIZACION
        )
    else:
        subida = cliente.post("/files", files={"file": (hostil, b"x")}, headers=_AUTORIZACION)
    assert subida.status_code == 201
    assert subida.json()["nombre"] == "passwd"
    [guardado] = _archivos(tmp_path, "uploads")
    assert guardado.name == "passwd"
    assert guardado.resolve().is_relative_to((tmp_path / "trabajo" / "uploads").resolve())
    fuera = [
        p for p in tmp_path.rglob("*") if p.is_file() and not p.is_relative_to(tmp_path / "trabajo")
    ]
    assert fuera == []
    descarga = cliente.get(subida.json()["url"], headers=_AUTORIZACION)
    assert 'filename="passwd"' in descarga.headers["content-disposition"]


# Un nombre con tildes y espacios se codifica con filename* y un respaldo ASCII.
def test_nombre_con_tildes(cliente: TestClient) -> None:
    subida = cliente.post(
        "/files", params={"nombre": "informe año.pdf"}, content=b"%PDF", headers=_AUTORIZACION
    )
    assert subida.json()["nombre"] == "informe año.pdf"
    cabecera = cliente.get(subida.json()["url"], headers=_AUTORIZACION).headers[
        "content-disposition"
    ]
    assert cabecera.isascii()
    assert 'filename="informe a_o.pdf"' in cabecera
    assert "filename*=UTF-8''informe%20a%C3%B1o.pdf" in cabecera


# Un cuerpo crudo de max_bytes + 1 da 413 y justo max_bytes se acepta.
def test_limite_crudo(cliente: TestClient, tmp_path: Path) -> None:
    excedido = cliente.post("/files", content=b"x" * (_MB + 1), headers=_AUTORIZACION)
    assert excedido.status_code == 413
    _verificar_error(excedido.json(), "limite_excedido", tmp_path)
    assert _archivos(tmp_path, "uploads") == []
    justo = cliente.post("/files", content=b"x" * _MB, headers=_AUTORIZACION)
    assert justo.status_code == 201
    assert justo.json()["tamano"] == _MB


# Sin Content-Length el cuerpo se corta al superar el tope mientras se lee.
def test_limite_sin_content_length(cliente: TestClient, tmp_path: Path) -> None:
    # Generador que entrega 2 MB en trozos, lo que obliga a enviar el cuerpo troceado.
    def trozos() -> Iterator[bytes]:
        for _ in range(32):
            yield b"x" * (64 * 1024)

    respuesta = cliente.post("/files", content=trozos(), headers=_AUTORIZACION)
    assert respuesta.status_code == 413
    _verificar_error(respuesta.json(), "limite_excedido", tmp_path)
    assert _archivos(tmp_path, "uploads") == []


# Un multipart demasiado grande da 413, tanto por Content-Length como por tamaño final.
def test_limite_multipart(cliente: TestClient, tmp_path: Path) -> None:
    enorme = cliente.post(
        "/files", files={"file": ("a.bin", b"x" * (2 * _MB))}, headers=_AUTORIZACION
    )
    assert enorme.status_code == 413
    _verificar_error(enorme.json(), "limite_excedido", tmp_path)
    # Entra en el margen del envoltorio pero el archivo en sí supera el tope.
    margen = cliente.post(
        "/files", files={"file": ("a.bin", b"x" * (_MB + 10))}, headers=_AUTORIZACION
    )
    assert margen.status_code == 413
    assert _archivos(tmp_path, "uploads") == []


# Un archivo vacío da 400 y no se guarda nada.
def test_archivo_vacio(cliente: TestClient, tmp_path: Path) -> None:
    cruda = cliente.post("/files", content=b"", headers=_AUTORIZACION)
    multipart = cliente.post("/files", files={"file": ("a.txt", b"")}, headers=_AUTORIZACION)
    for respuesta in (cruda, multipart):
        assert respuesta.status_code == 400
        _verificar_error(respuesta.json(), "argumento_invalido", tmp_path)
    assert _archivos(tmp_path, "uploads") == []


# Un multipart sin campo de archivo da 415.
def test_multipart_sin_archivo(cliente: TestClient, tmp_path: Path) -> None:
    respuesta = cliente.post(
        "/files",
        data={"texto": "hola"},
        files={"otro": ("a.txt", b"x")},
        headers=_AUTORIZACION,
    )
    assert respuesta.status_code == 415
    _verificar_error(respuesta.json(), "formato_no_soportado", tmp_path)
    assert _archivos(tmp_path, "uploads") == []


# Un multipart mal formado da 400 sin detalles internos.
def test_multipart_malformado(cliente: TestClient, tmp_path: Path) -> None:
    respuesta = cliente.post(
        "/files",
        content=b"basura",
        headers={**_AUTORIZACION, "Content-Type": "multipart/form-data"},
    )
    assert respuesta.status_code == 400
    _verificar_error(respuesta.json(), "argumento_invalido", tmp_path)


# Un id con formato válido pero inexistente da 404.
def test_descarga_inexistente(cliente: TestClient, tmp_path: Path) -> None:
    respuesta = cliente.get("/files/" + "a" * 22, headers=_AUTORIZACION)
    assert respuesta.status_code == 404
    _verificar_error(respuesta.json(), "archivo_no_encontrado", tmp_path)


# Un id de formato inválido nunca devuelve contenido.
@pytest.mark.parametrize("identificador", ["..%2F..%2Fetc", "abc", "a" * 100, "%2e%2e"])
def test_descarga_id_invalido(cliente: TestClient, identificador: str) -> None:
    respuesta = cliente.get(f"/files/{identificador}", headers=_AUTORIZACION)
    assert respuesta.status_code in (400, 404)
    assert re.search(r"root:|passwd", respuesta.text) is None


# Un id de formato inválido que llega a la ruta responde 400.
def test_descarga_id_corto_da_400(cliente: TestClient, tmp_path: Path) -> None:
    respuesta = cliente.get("/files/abc", headers=_AUTORIZACION)
    assert respuesta.status_code == 400
    _verificar_error(respuesta.json(), "argumento_invalido", tmp_path)


# Un archivo de outputs/ también se puede descargar.
def test_descarga_de_outputs(cliente: TestClient, tmp_path: Path) -> None:
    salida = Almacen(tmp_path / "trabajo").guardar_salida("resultado.pdf", b"%PDF-salida")
    respuesta = cliente.get(f"/files/{salida.id}", headers=_AUTORIZACION)
    assert respuesta.status_code == 200
    assert respuesta.content == b"%PDF-salida"
    assert 'filename="resultado.pdf"' in respuesta.headers["content-disposition"]


# Un método no permitido responde 405.
def test_metodo_no_permitido(cliente: TestClient) -> None:
    assert cliente.delete("/files/" + "a" * 22, headers=_AUTORIZACION).status_code == 405
    assert cliente.get("/files", headers=_AUTORIZACION).status_code == 405
    assert cliente.post("/files/" + "a" * 22, headers=_AUTORIZACION).status_code == 405


# Un fallo inesperado al guardar da 500 genérico sin rutas ni detalles internos.
def test_error_interno_generico(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Simula un error de disco con la ruta del servidor en el mensaje.
    def _falla(self: Almacen, nombre: str, datos: bytes) -> None:
        raise OSError(f"fallo en {tmp_path}/secreto")

    monkeypatch.setattr(Almacen, "guardar_subida", _falla)
    with TestClient(crear_servidor(_config(tmp_path)).http_app()) as cliente:
        respuesta = cliente.post("/files", content=b"x", headers=_AUTORIZACION)
    assert respuesta.status_code == 500
    assert "secreto" not in respuesta.text
    assert str(tmp_path) not in respuesta.text


# El mapeo de errores de dominio a estados HTTP es el acordado.
def test_mapeo_de_estados() -> None:
    assert estado_http(ErrorArgumento("a", "b")) == 400
    assert estado_http(ErrorRutaInsegura("a", "b")) == 400
    assert estado_http(ErrorNoAutorizado("a", "b")) == 401
    assert estado_http(ErrorArchivoNoEncontrado("a", "b")) == 404
    assert estado_http(ErrorLimiteExcedido("a", "b")) == 413
    assert estado_http(ErrorTiempoAgotado("a", "b")) == 500
