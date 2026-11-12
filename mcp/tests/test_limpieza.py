"""Pruebas del borrado automático de archivos vencidos por TTL."""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
import pytest
from fastmcp import Client

from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import limpieza
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.limpieza import (
    borrar_vencidos,
    bucle_de_limpieza,
    intervalo_de_revision,
)

_TTL = 60


# Backend asíncrono único para anyio.
@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Almacén preparado dentro de tmp_path.
@pytest.fixture
def almacen(tmp_path: Path) -> Almacen:
    nuevo = Almacen(tmp_path / "trabajo")
    nuevo.preparar()
    return nuevo


# Fija la fecha de modificación de una ruta a hace `minutos` minutos respecto de `ahora`.
def _envejecer(ruta: Path, ahora: datetime, minutos: float) -> None:
    marca = (ahora - timedelta(minutes=minutos)).timestamp()
    os.utime(ruta, (marca, marca))


# Borra de ambas zonas lo vencido y conserva lo reciente.
def test_borra_vencidos_en_ambas_zonas(almacen: Almacen) -> None:
    ahora = datetime.now(UTC)
    viejo_subida = almacen.guardar_subida("a.txt", b"a")
    viejo_salida = almacen.guardar_salida("b.txt", b"b")
    nuevo_subida = almacen.guardar_subida("c.txt", b"c")
    nuevo_salida = almacen.guardar_salida("d.txt", b"d")
    _envejecer(viejo_subida.ruta, ahora, _TTL + 5)
    _envejecer(viejo_salida.ruta, ahora, _TTL + 5)
    _envejecer(nuevo_subida.ruta, ahora, 5)
    _envejecer(nuevo_salida.ruta, ahora, 5)
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 2
    assert not viejo_subida.ruta.exists()
    assert not viejo_salida.ruta.exists()
    assert nuevo_subida.ruta.exists()
    assert nuevo_salida.ruta.exists()
    assert not viejo_subida.ruta.parent.exists()


# Justo en el borde del TTL no se borra; un instante después sí.
def test_borde_del_ttl(almacen: Almacen) -> None:
    ahora = datetime.now(UTC)
    archivo = almacen.guardar_subida("a.txt", b"a")
    _envejecer(archivo.ruta, ahora, _TTL)
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 0
    assert archivo.ruta.exists()
    assert borrar_vencidos(almacen, _TTL, ahora=ahora + timedelta(seconds=1)) == 1
    assert not archivo.ruta.exists()


# Una carpeta de id vacía vieja se limpia y una reciente (reserva en curso) se conserva.
def test_carpetas_vacias(almacen: Almacen) -> None:
    ahora = datetime.now(UTC)
    vieja = almacen.reservar_salida("x.pdf").ruta.parent
    reciente = almacen.reservar_salida("y.pdf").ruta.parent
    _envejecer(vieja, ahora, _TTL + 5)
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 0
    assert not vieja.exists()
    assert reciente.exists()


# Una carpeta con solo un temporal .parcial- sigue la antigüedad de la carpeta.
def test_carpeta_con_solo_parcial(almacen: Almacen) -> None:
    ahora = datetime.now(UTC)
    carpeta = almacen.reservar_salida("x.pdf").ruta.parent
    (carpeta / ".parcial-abc").write_bytes(b"x")
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 0
    assert carpeta.exists()
    _envejecer(carpeta, ahora, _TTL + 5)
    borrar_vencidos(almacen, _TTL, ahora=ahora)
    assert not carpeta.exists()


# Lo que no tiene forma de id se ignora aunque sea viejo.
def test_ignora_basura(almacen: Almacen) -> None:
    ahora = datetime.now(UTC)
    base = almacen.guardar_subida("a.txt", b"a").ruta.parent.parent
    suelto = base / "suelto.txt"
    suelto.write_text("x")
    carpeta_corta = base / "corta"
    carpeta_corta.mkdir()
    (carpeta_corta / "f.txt").write_text("x")
    for ruta in (suelto, carpeta_corta, carpeta_corta / "f.txt"):
        _envejecer(ruta, ahora, _TTL + 500)
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 0
    assert suelto.exists()
    assert (carpeta_corta / "f.txt").exists()


# Un symlink con forma de id que apunta fuera no provoca borrados externos.
def test_symlink_no_se_sigue(almacen: Almacen, tmp_path: Path) -> None:
    ahora = datetime.now(UTC)
    externa = tmp_path / "externa"
    externa.mkdir()
    ajeno = externa / "importante.txt"
    ajeno.write_text("no tocar")
    _envejecer(ajeno, ahora, _TTL + 500)
    _envejecer(externa, ahora, _TTL + 500)
    enlace = tmp_path / "trabajo" / "uploads" / ("a" * 22)
    enlace.symlink_to(externa, target_is_directory=True)
    assert borrar_vencidos(almacen, _TTL, ahora=ahora) == 0
    assert ajeno.exists()
    assert enlace.is_symlink()


# Sin carpetas de trabajo creadas no falla y devuelve 0.
def test_sin_carpetas(tmp_path: Path) -> None:
    assert borrar_vencidos(Almacen(tmp_path / "nada"), _TTL) == 0


# El intervalo es un cuarto del TTL acotado entre 30 s y 15 min.
def test_intervalo_de_revision() -> None:
    assert intervalo_de_revision(1) == 30.0
    assert intervalo_de_revision(60) == 900.0
    assert intervalo_de_revision(10) == 150.0
    assert intervalo_de_revision(100000) == 900.0


# El bucle borra un vencido y se cancela sin error.
@pytest.mark.anyio
async def test_bucle_borra_y_se_cancela(almacen: Almacen) -> None:
    archivo = almacen.guardar_subida("a.txt", b"a")
    _envejecer(archivo.ruta, datetime.now(UTC), _TTL + 5)
    with anyio.move_on_after(0.2):
        await bucle_de_limpieza(almacen, _TTL, intervalo_s=0.01)
    assert not archivo.ruta.exists()


# Una pasada que lanza no detiene el bucle.
@pytest.mark.anyio
async def test_bucle_sobrevive_a_una_pasada_fallida(
    almacen: Almacen, monkeypatch: pytest.MonkeyPatch
) -> None:
    archivo = almacen.guardar_subida("a.txt", b"a")
    _envejecer(archivo.ruta, datetime.now(UTC), _TTL + 5)
    real = limpieza.borrar_vencidos
    llamadas: list[int] = []

    def _falla_una_vez(alm: Almacen, ttl: int) -> int:
        llamadas.append(1)
        if len(llamadas) == 1:
            raise OSError("fallo simulado")
        return real(alm, ttl)

    monkeypatch.setattr(limpieza, "borrar_vencidos", _falla_una_vez)
    with anyio.move_on_after(0.3):
        await bucle_de_limpieza(almacen, _TTL, intervalo_s=0.01)
    assert len(llamadas) >= 2
    assert not archivo.ruta.exists()


# Al conectar se crean las zonas y se borra lo vencido; al salir no quedan tareas colgadas.
@pytest.mark.anyio
async def test_ciclo_de_vida_con_cliente(tmp_path: Path) -> None:
    trabajo = tmp_path / "trabajo"
    config = Configuracion(carpeta_trabajo=trabajo)
    almacen = Almacen(trabajo)
    archivo = almacen.guardar_subida("a.txt", b"a")
    _envejecer(archivo.ruta, datetime.now(UTC), config.ttl_minutos + 5)
    tareas_antes = asyncio.all_tasks()
    async with Client(crear_servidor(config)) as cliente:
        await cliente.list_tools()
        assert (trabajo / "uploads").is_dir()
        assert (trabajo / "outputs").is_dir()
        assert not archivo.ruta.exists()
    await asyncio.sleep(0)
    assert asyncio.all_tasks() <= tareas_antes
