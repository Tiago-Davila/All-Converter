"""Límites de tamaño, cantidad de bloques o filas y tiempo para las herramientas."""

from __future__ import annotations

import functools
from collections.abc import Awaitable, Callable, Sequence

import anyio
import anyio.to_thread

from convertitodo_mcp.blocks import Bloque, ItemLista, Lista, Tabla
from convertitodo_mcp.errores import ErrorLimiteExcedido, ErrorTiempoAgotado
from convertitodo_mcp.server.config import Configuracion

_BYTES_POR_MB = 1024 * 1024


# Pone en mayúscula solo la primera letra, sin alterar siglas como PDF.
def _mayuscula(texto: str) -> str:
    return texto[:1].upper() + texto[1:]


# Expresa una cantidad de bytes en MB legibles, con dos decimales.
def _mb(cantidad_bytes: int) -> str:
    return f"{cantidad_bytes / _BYTES_POR_MB:.2f} MB"


# Rechaza una cantidad de bytes que supera el tope configurado.
def _verificar_bytes(cantidad_bytes: int, config: Configuracion, que: str) -> None:
    if cantidad_bytes > config.max_bytes:
        raise ErrorLimiteExcedido(
            f"{_mayuscula(que)} pesa {_mb(cantidad_bytes)} y el máximo permitido es "
            f"{config.max_mb} MB.",
            f"achicá {que} o dividilo en varias partes más chicas y procesalas por separado.",
        )


# Lanza ErrorLimiteExcedido si el tamaño en bytes supera el máximo de entrada.
def verificar_tamano(
    cantidad_bytes: int, config: Configuracion, *, que: str = "el archivo"
) -> None:
    _verificar_bytes(cantidad_bytes, config, que)


# Lanza ErrorLimiteExcedido si el texto, codificado en UTF-8, supera el máximo de entrada.
def verificar_texto(texto: str, config: Configuracion, *, que: str = "el texto") -> None:
    _verificar_bytes(len(texto.encode("utf-8")), config, que)


# Cuenta los items de una lista, incluidos los de sus sublistas.
def _contar_items(lista: Lista) -> int:
    return sum(_contar_item(item) for item in lista.items)


# Cuenta un item de lista más todo lo que contiene su sublista.
def _contar_item(item: ItemLista) -> int:
    return 1 + (_contar_items(item.sublista) if item.sublista is not None else 0)


# Cuenta bloques; cada lista suma 1 más sus items y cada tabla 1 más sus filas.
def contar_bloques(bloques: Sequence[Bloque]) -> int:
    total = 0
    for bloque in bloques:
        total += 1
        if isinstance(bloque, Lista):
            total += _contar_items(bloque)
        elif isinstance(bloque, Tabla):
            total += len(bloque.filas)
    return total


# Suma las filas de todas las tablas; el encabezado no cuenta.
def contar_filas(bloques: Sequence[Bloque]) -> int:
    return sum(len(b.filas) for b in bloques if isinstance(b, Tabla))


# Lanza ErrorLimiteExcedido si hay demasiados bloques o filas de tabla.
def verificar_bloques(bloques: Sequence[Bloque], config: Configuracion) -> None:
    cantidad = contar_bloques(bloques)
    if cantidad > config.max_bloques:
        raise ErrorLimiteExcedido(
            f"El documento tiene {cantidad} bloques (contando items de lista y filas de "
            f"tabla) y el máximo permitido es {config.max_bloques}.",
            "dividí el documento en varios archivos con menos contenido cada uno.",
        )
    filas = contar_filas(bloques)
    if filas > config.max_filas:
        raise ErrorLimiteExcedido(
            f"Las tablas del documento suman {filas} filas y el máximo permitido es "
            f"{config.max_filas}.",
            "dividí el documento en varios archivos con menos filas cada uno.",
        )


# Lanza ErrorLimiteExcedido si una planilla tiene más filas que el máximo.
def verificar_filas(cantidad: int, config: Configuracion, *, que: str = "la planilla") -> None:
    if cantidad > config.max_filas:
        raise ErrorLimiteExcedido(
            f"{_mayuscula(que)} tiene {cantidad} filas y el máximo permitido es "
            f"{config.max_filas}.",
            f"dividí {que} en varias partes con menos filas cada una.",
        )


# Exige un plazo positivo: un valor inválido es un error de programación.
def _validar_segundos(segundos: float) -> None:
    if segundos <= 0:
        raise ValueError(f"segundos debe ser mayor que 0, se recibió {segundos}")


# Construye el error de tiempo agotado con el plazo esperado y cómo corregirlo.
def _error_tiempo(segundos: float, que: str) -> ErrorTiempoAgotado:
    return ErrorTiempoAgotado(
        f"{_mayuscula(que)} tardó más de {segundos:g} segundos y se canceló.",
        "usá un documento más chico, dividilo en partes o pedí al administrador que suba "
        "CONVERTITODO_MCP_TIMEOUT_S.",
    )


# Ejecuta una función bloqueante en un hilo y la abandona al vencer el plazo.
async def ejecutar_con_limite[R](
    funcion: Callable[[], R], segundos: float, *, que: str = "la operación"
) -> R:
    _validar_segundos(segundos)
    try:
        with anyio.fail_after(segundos) as alcance:
            # Un hilo abandonado sigue corriendo hasta terminar (Python no puede matarlo): por eso
            # los topes de tamaño y de bloques son la defensa principal.
            return await anyio.to_thread.run_sync(funcion, abandon_on_cancel=True)
    except TimeoutError:
        if not alcance.cancelled_caught:
            raise
        raise _error_tiempo(segundos, que) from None


# Decorador que limita el tiempo de una función async y conserva su firma.
def con_limite_de_tiempo[**P, R](
    segundos: float, *, que: str = "la operación"
) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    _validar_segundos(segundos)

    # Envuelve la función async con el plazo indicado.
    def decorador(funcion: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(funcion)
        async def envoltura(*args: P.args, **kwargs: P.kwargs) -> R:
            try:
                with anyio.fail_after(segundos) as alcance:
                    return await funcion(*args, **kwargs)
            except TimeoutError:
                if not alcance.cancelled_caught:
                    raise
                raise _error_tiempo(segundos, que) from None

        return envoltura

    return decorador
