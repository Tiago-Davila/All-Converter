"""Línea de comandos que arranca el servidor por stdio o por HTTP."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from pydantic import ValidationError

from convertitodo_mcp import __version__
from convertitodo_mcp.errores import ErrorConfiguracion, ErrorConvertiTodo
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.auth import validar_arranque
from convertitodo_mcp.server.config import Configuracion, cargar_configuracion


# Construye el analizador de argumentos en español.
def _crear_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="convertitodo-mcp",
        description="Servidor MCP de ConvertiTodo. Los argumentos pisan al entorno.",
    )
    parser.add_argument("--transporte", choices=["stdio", "http"], help="transporte a usar")
    parser.add_argument("--host", help="dirección en la que escucha el transporte HTTP")
    parser.add_argument("--puerto", type=int, help="puerto del transporte HTTP")
    parser.add_argument("--version", action="version", version=f"convertitodo-mcp {__version__}")
    return parser


# Arranca el servidor con el transporte de la configuración (bloquea hasta que termine).
def ejecutar(config: Configuracion) -> None:
    validar_arranque(config)
    servidor = crear_servidor(config)
    if config.transporte == "http":
        servidor.run(transport="http", show_banner=False, host=config.host, port=config.puerto)
    else:
        servidor.run(transport="stdio", show_banner=False)


# Aplica los argumentos sobre la configuración revalidándola y traduciendo los fallos.
def _aplicar_argumentos(config: Configuracion, cambios: dict[str, object]) -> Configuracion:
    puerto = cambios.get("puerto")
    host = cambios.get("host")
    puerto_invalido = isinstance(puerto, int) and not 1 <= puerto <= 65535
    host_invalido = isinstance(host, str) and not host.strip()
    if puerto_invalido or host_invalido:
        raise ErrorConfiguracion(
            "Los argumentos de la línea de comandos no son válidos.",
            "usá un --puerto entre 1 y 65535 y un --host que no esté vacío.",
        )
    try:
        return Configuracion.model_validate({**config.model_dump(), **cambios})
    except ValidationError:
        raise ErrorConfiguracion(
            "Los argumentos de la línea de comandos no son válidos.",
            "usá --transporte stdio o http, un --host no vacío y un --puerto entre 1 y 65535.",
        ) from None


# Punto de entrada: devuelve 0 si termina bien y 2 si la configuración es inválida.
def main(argv: Sequence[str] | None = None) -> int:
    parser = _crear_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as salida:
        return salida.code if isinstance(salida.code, int) else 2
    try:
        config = cargar_configuracion()
        cambios: dict[str, object] = {}
        if args.transporte is not None:
            cambios["transporte"] = args.transporte
        if args.host is not None:
            cambios["host"] = args.host
        if args.puerto is not None:
            cambios["puerto"] = args.puerto
        if cambios:
            config = _aplicar_argumentos(config, cambios)
        ejecutar(config)
    except ErrorConvertiTodo as error:
        print(error.mensaje_para_modelo(), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 0
    return 0
