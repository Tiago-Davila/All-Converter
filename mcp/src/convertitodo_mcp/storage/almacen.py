"""Carpetas de trabajo uploads/ y outputs/ con ids opacos y nombres saneados."""

from __future__ import annotations

import secrets
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, get_args

from convertitodo_mcp.errores import ErrorArchivoNoEncontrado, ErrorRutaInsegura
from convertitodo_mcp.storage.rutas import (
    asegurar_dentro,
    es_id_valido,
    resolver_dentro,
    sanear_nombre,
    validar_id,
)

Zona = Literal["uploads", "outputs"]

_ZONAS: tuple[Zona, ...] = get_args(Zona)
_PREFIJO_PARCIAL = ".parcial-"
_PERMISOS_CARPETA = 0o700
_PERMISOS_ARCHIVO = 0o600


# Archivo guardado en una zona de trabajo, identificado por un id opaco.
@dataclass(frozen=True, slots=True)
class ArchivoGuardado:
    id: str
    nombre: str
    zona: Zona
    ruta: Path
    tamano: int
    creado: datetime


# Almacén en disco de archivos subidos y generados, una carpeta por id.
class Almacen:
    # Guarda la carpeta base sin tocar el disco.
    def __init__(self, carpeta_trabajo: Path) -> None:
        self._base = carpeta_trabajo

    # Crea la carpeta de trabajo y sus zonas con permisos 0o700; es idempotente.
    def preparar(self) -> None:
        for carpeta in (self._base, *(self._base / zona for zona in _ZONAS)):
            carpeta.mkdir(mode=_PERMISOS_CARPETA, parents=True, exist_ok=True)
            carpeta.chmod(_PERMISOS_CARPETA)

    # Guarda los bytes de un archivo subido y devuelve sus datos.
    def guardar_subida(self, nombre: str, datos: bytes) -> ArchivoGuardado:
        return self._guardar("uploads", nombre, datos)

    # Guarda los bytes de un archivo generado y devuelve sus datos.
    def guardar_salida(self, nombre: str, datos: bytes) -> ArchivoGuardado:
        return self._guardar("outputs", nombre, datos)

    # Crea la carpeta del id y devuelve la ruta donde un renderizador escribirá la salida.
    def reservar_salida(self, nombre: str) -> ArchivoGuardado:
        self.preparar()
        identificador, carpeta, nombre_saneado = self._nueva_carpeta("outputs", nombre)
        return ArchivoGuardado(
            id=identificador,
            nombre=nombre_saneado,
            zona="outputs",
            ruta=resolver_dentro(carpeta, nombre_saneado),
            tamano=0,
            creado=datetime.now(UTC),
        )

    # Busca el id en ambas zonas y devuelve sus datos actuales o lanza ErrorArchivoNoEncontrado.
    def obtener(self, identificador: str) -> ArchivoGuardado:
        validar_id(identificador)
        self.preparar()
        for zona in _ZONAS:
            encontrado = self._buscar(zona, identificador)
            if encontrado is not None:
                return encontrado
        raise ErrorArchivoNoEncontrado(
            "No existe un archivo con ese id.",
            "revisá que el id sea exactamente el que devolvió la herramienta anterior o "
            "subí el archivo de nuevo; los archivos se borran automáticamente pasado un tiempo.",
        )

    # Devuelve el contenido completo del archivo con ese id.
    def leer(self, identificador: str) -> bytes:
        return self.obtener(identificador).ruta.read_bytes()

    # Borra la carpeta del id; devuelve False si no existía.
    def borrar(self, identificador: str) -> bool:
        validar_id(identificador)
        self.preparar()
        borro = False
        for zona in _ZONAS:
            carpeta = self._carpeta_existente(zona, identificador)
            if carpeta is not None:
                shutil.rmtree(carpeta, ignore_errors=True)
                borro = True
        return borro

    # Lista los archivos de una zona (o de ambas) ordenados por fecha de creación.
    def listar(self, zona: Zona | None = None) -> list[ArchivoGuardado]:
        self.preparar()
        encontrados: list[ArchivoGuardado] = []
        for z in (zona,) if zona is not None else _ZONAS:
            for entrada in sorted((self._base / z).iterdir()):
                if not es_id_valido(entrada.name):
                    continue
                archivo = self._buscar(z, entrada.name)
                if archivo is not None:
                    encontrados.append(archivo)
        return sorted(encontrados, key=lambda a: a.creado)

    # Genera un id opaco y crea su carpeta; devuelve id, carpeta y nombre saneado.
    def _nueva_carpeta(self, zona: Zona, nombre: str) -> tuple[str, Path, str]:
        nombre_saneado = sanear_nombre(nombre)
        zona_dir = self._base / zona
        while True:
            identificador = secrets.token_urlsafe(16)
            carpeta = resolver_dentro(zona_dir, identificador)
            try:
                carpeta.mkdir(mode=_PERMISOS_CARPETA)
            except FileExistsError:
                continue
            carpeta.chmod(_PERMISOS_CARPETA)
            return identificador, carpeta, nombre_saneado

    # Escribe de forma atómica en <zona>/<id>/<nombre_saneado>.
    def _guardar(self, zona: Zona, nombre: str, datos: bytes) -> ArchivoGuardado:
        self.preparar()
        identificador, carpeta, nombre_saneado = self._nueva_carpeta(zona, nombre)
        destino = resolver_dentro(carpeta, nombre_saneado)
        parcial = carpeta / f"{_PREFIJO_PARCIAL}{secrets.token_hex(8)}"
        try:
            parcial.touch(mode=_PERMISOS_ARCHIVO, exist_ok=False)
            parcial.chmod(_PERMISOS_ARCHIVO)
            parcial.write_bytes(datos)
            parcial.replace(destino)
        except BaseException:
            shutil.rmtree(carpeta, ignore_errors=True)
            raise
        archivo = self._buscar(zona, identificador)
        if archivo is None:
            raise ErrorArchivoNoEncontrado(
                "No se pudo guardar el archivo.", "reintentá la operación."
            )
        return archivo

    # Devuelve la carpeta real del id en la zona, o None si no existe o es insegura.
    def _carpeta_existente(self, zona: Zona, identificador: str) -> Path | None:
        try:
            carpeta = resolver_dentro(self._base / zona, identificador)
        except ErrorRutaInsegura:
            return None
        if carpeta.is_dir() and not carpeta.is_symlink():
            return carpeta
        return None

    # Lee del disco el único archivo regular de la carpeta del id, o None si no es válido.
    def _buscar(self, zona: Zona, identificador: str) -> ArchivoGuardado | None:
        carpeta = self._carpeta_existente(zona, identificador)
        if carpeta is None:
            return None
        try:
            entradas = [e for e in carpeta.iterdir() if not e.name.startswith(_PREFIJO_PARCIAL)]
        except OSError:
            return None
        for entrada in entradas:
            if entrada.is_symlink() or not entrada.is_file():
                continue
            try:
                ruta = asegurar_dentro(carpeta, entrada)
                estado = ruta.stat()
            except (ErrorRutaInsegura, OSError):
                continue
            return ArchivoGuardado(
                id=identificador,
                nombre=entrada.name,
                zona=zona,
                ruta=ruta,
                tamano=estado.st_size,
                creado=datetime.fromtimestamp(estado.st_mtime, UTC),
            )
        return None
