"""Rutas HTTP para subir (POST /files) y descargar (GET /files/{id}) archivos con token."""

from __future__ import annotations

import logging
import mimetypes
from collections.abc import AsyncIterator
from urllib.parse import quote

import anyio.to_thread
from fastmcp import FastMCP
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.types import Message

from convertitodo_mcp.errores import (
    ErrorArchivoNoEncontrado,
    ErrorArgumento,
    ErrorConvertiTodo,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
    ErrorNoAutorizado,
    ErrorRutaInsegura,
)
from convertitodo_mcp.limites import verificar_tamano
from convertitodo_mcp.server.auth import peticion_autorizada, respuesta_no_autorizada
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen
from convertitodo_mcp.storage.rutas import validar_id

_registro = logging.getLogger(__name__)

# Margen para el envoltorio multipart (límites, cabeceras de parte) sobre el tamaño del archivo.
_MARGEN_MULTIPART = 64 * 1024
_CAMPOS_ARCHIVO = ("file", "archivo")
_PARAMETROS_NOMBRE = ("nombre", "filename")
_NOMBRE_POR_DEFECTO = "archivo"
_TIPO_POR_DEFECTO = "application/octet-stream"
_ESTADOS: tuple[tuple[type[ErrorConvertiTodo], int], ...] = (
    (ErrorNoAutorizado, 401),
    (ErrorArchivoNoEncontrado, 404),
    (ErrorLimiteExcedido, 413),
    (ErrorFormatoNoSoportado, 415),
    (ErrorArgumento, 400),
    (ErrorRutaInsegura, 400),
)
_MENSAJE_GENERICO = (
    "Error interno al procesar el archivo. Cómo corregirlo: reintentá la petición y, "
    "si el error persiste, avisá al administrador del servidor."
)


# Devuelve el estado HTTP que corresponde a un error de dominio (500 si no hay uno específico).
def estado_http(error: ErrorConvertiTodo) -> int:
    for tipo, estado in _ESTADOS:
        if isinstance(error, tipo):
            return estado
    return 500


# Arma la respuesta JSON de error con el mismo formato para todas las rutas.
def _respuesta_error(error: Exception) -> JSONResponse:
    if isinstance(error, ErrorConvertiTodo):
        estado = estado_http(error)
        if estado != 500:
            cuerpo = {"error": error.codigo, "mensaje": error.mensaje_para_modelo()}
            return JSONResponse(cuerpo, status_code=estado)
    return JSONResponse({"error": "error", "mensaje": _MENSAJE_GENERICO}, status_code=500)


# Error de límite con el tope configurado, sin conocer el tamaño real del cuerpo.
def _error_limite(config: Configuracion) -> ErrorLimiteExcedido:
    return ErrorLimiteExcedido(
        f"El archivo supera el máximo permitido de {config.max_mb} MB.",
        "subí un archivo más chico, dividilo en partes o pedí al administrador que suba "
        "CONVERTITODO_MCP_MAX_MB.",
    )


# Rechaza antes de leer el cuerpo si Content-Length declara más de lo permitido.
def _verificar_content_length(request: Request, config: Configuracion, tope: int) -> None:
    declarado = request.headers.get("content-length")
    if declarado is None:
        return
    try:
        largo = int(declarado)
    except ValueError:
        raise ErrorArgumento(
            "La cabecera Content-Length no es un número válido.",
            "enviá una petición HTTP bien formada con el tamaño real del cuerpo.",
        ) from None
    if largo < 0:
        raise ErrorArgumento(
            "La cabecera Content-Length no es válida.",
            "enviá una petición HTTP bien formada con el tamaño real del cuerpo.",
        )
    if largo > tope:
        raise _error_limite(config)


# Lee el cuerpo crudo contando bytes y se corta apenas supera el tope.
async def _leer_cuerpo(flujo: AsyncIterator[bytes], config: Configuracion, tope: int) -> bytes:
    acumulado = bytearray()
    async for trozo in flujo:
        acumulado.extend(trozo)
        if len(acumulado) > tope:
            raise _error_limite(config)
    return bytes(acumulado)


# Crea una Request cuyo cuerpo se corta con ErrorLimiteExcedido al superar el tope.
def _peticion_con_tope(request: Request, config: Configuracion, tope: int) -> Request:
    recibidos = 0

    # Cuenta los bytes de cada trozo del cuerpo antes de entregarlo al parser.
    async def recibir() -> Message:
        nonlocal recibidos
        mensaje = await request.receive()
        if mensaje["type"] == "http.request":
            recibidos += len(mensaje.get("body", b""))
            if recibidos > tope:
                raise _error_limite(config)
        return mensaje

    return Request(request.scope, recibir)


# Extrae nombre y bytes del campo de archivo de un multipart, con el tamaño ya limitado.
async def _leer_multipart(request: Request, config: Configuracion) -> tuple[str, bytes]:
    peticion = _peticion_con_tope(request, config, config.max_bytes + _MARGEN_MULTIPART)
    try:
        async with peticion.form(max_files=5, max_fields=20) as formulario:
            for clave, valor in formulario.multi_items():
                if clave in _CAMPOS_ARCHIVO and isinstance(valor, UploadFile):
                    if valor.size is not None and valor.size > config.max_bytes:
                        raise _error_limite(config)
                    datos = await valor.read()
                    return valor.filename or _NOMBRE_POR_DEFECTO, datos
    except HTTPException:
        raise ErrorArgumento(
            "El cuerpo multipart/form-data está mal formado.",
            "enviá el archivo en un campo llamado 'file' con un filename, por ejemplo "
            "con `curl -F file=@documento.pdf`.",
        ) from None
    raise ErrorFormatoNoSoportado(
        "El multipart/form-data no trae un campo de archivo llamado 'file' o 'archivo'.",
        "enviá el archivo como parte con filename en el campo 'file' "
        "(`curl -F file=@documento.pdf`) o como cuerpo crudo con ?nombre=documento.pdf.",
    )


# Obtiene nombre y bytes del cuerpo, sea multipart o crudo.
async def _leer_subida(request: Request, config: Configuracion) -> tuple[str, bytes]:
    tipo = request.headers.get("content-type", "").lower()
    if tipo.startswith("multipart/form-data"):
        _verificar_content_length(request, config, config.max_bytes + _MARGEN_MULTIPART)
        return await _leer_multipart(request, config)
    _verificar_content_length(request, config, config.max_bytes)
    nombre = next(
        (v for p in _PARAMETROS_NOMBRE if (v := request.query_params.get(p))), _NOMBRE_POR_DEFECTO
    )
    return nombre, await _leer_cuerpo(request.stream(), config, config.max_bytes)


# Valida el tamaño final y guarda el archivo; responde 201 con id, nombre, tamaño y url.
async def _subir(request: Request, almacen: Almacen, config: Configuracion) -> Response:
    nombre, datos = await _leer_subida(request, config)
    if not datos:
        raise ErrorArgumento(
            "El archivo recibido está vacío.",
            "enviá un archivo con contenido.",
        )
    verificar_tamano(len(datos), config)
    guardado = await anyio.to_thread.run_sync(almacen.guardar_subida, nombre, datos)
    return JSONResponse(
        {
            "id": guardado.id,
            "nombre": guardado.nombre,
            "tamano": guardado.tamano,
            "url": f"/files/{guardado.id}",
        },
        status_code=201,
    )


# Cabecera Content-Disposition con nombre ASCII de respaldo y filename* en UTF-8 (RFC 5987).
def _disposicion(nombre: str) -> str:
    respaldo = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in nombre)
    return f"attachment; filename=\"{respaldo}\"; filename*=UTF-8''{quote(nombre, safe='')}"


# Responde el contenido del archivo con el id dado como adjunto.
async def _descargar(identificador: str, almacen: Almacen) -> Response:
    validar_id(identificador)
    archivo = await anyio.to_thread.run_sync(almacen.obtener, identificador)
    tipo = mimetypes.guess_type(archivo.nombre)[0] or _TIPO_POR_DEFECTO
    return FileResponse(
        archivo.ruta,
        media_type=tipo,
        headers={
            "Content-Disposition": _disposicion(archivo.nombre),
            "X-Content-Type-Options": "nosniff",
        },
    )


# Registra POST /files y GET /files/{id}, ambas protegidas con el token Bearer.
def registrar_rutas_de_archivos(servidor: FastMCP, almacen: Almacen, config: Configuracion) -> None:
    # Sube un archivo a uploads/ (multipart o cuerpo crudo).
    @servidor.custom_route("/files", methods=["POST"])
    async def subir(request: Request) -> Response:
        if not peticion_autorizada(request, config):
            return respuesta_no_autorizada()
        try:
            return await _subir(request, almacen, config)
        except Exception as error:
            if not isinstance(error, ErrorConvertiTodo):
                _registro.exception("Fallo inesperado al subir un archivo")
            return _respuesta_error(error)

    # Descarga un archivo de uploads/ u outputs/ como adjunto.
    @servidor.custom_route("/files/{identificador}", methods=["GET"])
    async def descargar(request: Request) -> Response:
        if not peticion_autorizada(request, config):
            return respuesta_no_autorizada()
        try:
            return await _descargar(str(request.path_params["identificador"]), almacen)
        except Exception as error:
            if not isinstance(error, ErrorConvertiTodo):
                _registro.exception("Fallo inesperado al descargar un archivo")
            return _respuesta_error(error)
