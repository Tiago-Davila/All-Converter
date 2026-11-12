"""Borrado automático de archivos vencidos según el TTL, al arrancar y de forma periódica."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import anyio
import anyio.to_thread
from fastmcp import FastMCP

from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.rutas import es_id_valido

_LOG = logging.getLogger("convertitodo_mcp.limpieza")

_ZONAS = ("uploads", "outputs")
_PREFIJO_PARCIAL = ".parcial-"
_INTERVALO_MINIMO_S = 30.0
_INTERVALO_MAXIMO_S = 900.0
_FRACCION_DEL_TTL = 0.25


# Fecha de modificación en UTC de una ruta sin seguir symlinks, o None si no se puede leer.
def _mtime(ruta: Path) -> datetime | None:
    try:
        return datetime.fromtimestamp(ruta.lstat().st_mtime, UTC)
    except OSError:
        return None


# Fecha de referencia de una carpeta de id y si contiene un archivo real; None si no se lee.
def _referencia(carpeta: Path) -> tuple[datetime, bool] | None:
    try:
        with os.scandir(carpeta) as entradas:
            hijos = [e for e in entradas if not e.name.startswith(_PREFIJO_PARCIAL)]
            fechas = [
                f
                for e in hijos
                if e.is_file(follow_symlinks=False)
                if (f := _mtime(Path(e.path))) is not None
            ]
    except OSError:
        return None
    if fechas:
        return max(fechas), True
    carpeta_mtime = _mtime(carpeta)
    return (carpeta_mtime, False) if carpeta_mtime is not None else None


# Borra una carpeta de id si superó el TTL; devuelve (se borró, tenía un archivo real).
def _borrar_si_vencida(carpeta: Path, ahora: datetime, ttl_minutos: int) -> tuple[bool, bool]:
    referencia = _referencia(carpeta)
    if referencia is None:
        return False, False
    fecha, con_archivo = referencia
    if (ahora - fecha).total_seconds() <= ttl_minutos * 60:
        return False, con_archivo
    try:
        shutil.rmtree(carpeta)
    except OSError:
        return False, con_archivo
    return True, con_archivo


# Borra de uploads/ y outputs/ lo que superó el TTL y devuelve cuántos archivos borró.
def borrar_vencidos(almacen: Almacen, ttl_minutos: int, *, ahora: datetime | None = None) -> int:
    momento = ahora if ahora is not None else datetime.now(UTC)
    borrados = 0
    for zona in _ZONAS:
        carpeta_zona = almacen.carpeta_trabajo / zona
        if carpeta_zona.is_symlink() or not carpeta_zona.is_dir():
            continue
        try:
            with os.scandir(carpeta_zona) as entradas:
                candidatas = [
                    Path(e.path)
                    for e in entradas
                    if es_id_valido(e.name) and e.is_dir(follow_symlinks=False)
                ]
        except OSError:
            continue
        for carpeta in candidatas:
            se_borro, con_archivo = _borrar_si_vencida(carpeta, momento, ttl_minutos)
            if se_borro and con_archivo:
                borrados += 1
    return borrados


# Segundos entre revisiones: un cuarto del TTL, entre 30 s y 15 min.
def intervalo_de_revision(ttl_minutos: int) -> float:
    return min(_INTERVALO_MAXIMO_S, max(_INTERVALO_MINIMO_S, ttl_minutos * 60 * _FRACCION_DEL_TTL))


# Hace una pasada de borrado en un hilo y registra solo la cantidad borrada.
async def _pasada(almacen: Almacen, ttl_minutos: int) -> None:
    borrados = await anyio.to_thread.run_sync(borrar_vencidos, almacen, ttl_minutos)
    if borrados:
        _LOG.info("Se borraron %d archivos vencidos.", borrados)


# Bucle infinito que borra vencidos, espera el intervalo y repite hasta ser cancelado.
async def bucle_de_limpieza(
    almacen: Almacen, ttl_minutos: int, *, intervalo_s: float | None = None
) -> None:
    espera = intervalo_s if intervalo_s is not None else intervalo_de_revision(ttl_minutos)
    while True:
        try:
            await _pasada(almacen, ttl_minutos)
        except Exception:
            _LOG.warning("Falló una pasada de limpieza; se reintenta en la próxima revisión.")
        await anyio.sleep(espera)


# Crea el lifespan de FastMCP: prepara el almacén, limpia al arrancar y mantiene el bucle.
def crear_ciclo_de_vida(
    almacen: Almacen, config: Configuracion
) -> Callable[[FastMCP[Any]], AbstractAsyncContextManager[dict[str, Any]]]:
    @asynccontextmanager
    async def ciclo(_servidor: FastMCP[Any]) -> AsyncIterator[dict[str, Any]]:
        await anyio.to_thread.run_sync(almacen.preparar)
        try:
            await _pasada(almacen, config.ttl_minutos)
        except Exception:
            _LOG.warning("Falló la limpieza inicial; se reintenta en la próxima revisión.")
        # FastMCP entra y sale del lifespan desde tareas distintas, así que no sirve un TaskGroup.
        tarea = asyncio.create_task(bucle_de_limpieza(almacen, config.ttl_minutos))
        try:
            yield {}
        finally:
            tarea.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarea

    return ciclo
