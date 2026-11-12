"""Configuración del servidor leída desde variables de entorno."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, SecretStr

from convertitodo_mcp.errores import ErrorConfiguracion

PREFIJO = "CONVERTITODO_MCP_"

_LARGO_MINIMO_TOKEN = 16

_V_TRANSPORTE = PREFIJO + "TRANSPORTE"
_V_HOST = PREFIJO + "HOST"
_V_PUERTO = PREFIJO + "PORT"
_V_TOKEN = PREFIJO + "TOKEN"
_V_CARPETA = PREFIJO + "WORKDIR"
_V_TTL = PREFIJO + "TTL_MINUTOS"
_V_MAX_MB = PREFIJO + "MAX_MB"
_V_TIMEOUT = PREFIJO + "TIMEOUT_S"
_V_BLOQUES = PREFIJO + "MAX_BLOQUES"
_V_FILAS = PREFIJO + "MAX_FILAS"

_VARIABLES_VALIDAS = (
    _V_TRANSPORTE,
    _V_HOST,
    _V_PUERTO,
    _V_TOKEN,
    _V_CARPETA,
    _V_TTL,
    _V_MAX_MB,
    _V_TIMEOUT,
    _V_BLOQUES,
    _V_FILAS,
)


# Configuración inmutable del servidor con todos los valores ya validados.
class Configuracion(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    transporte: Literal["stdio", "http"] = "stdio"
    host: str = "127.0.0.1"
    puerto: int = 8765
    token: SecretStr | None = None
    carpeta_trabajo: Path
    ttl_minutos: int = 60
    max_mb: int = 25
    timeout_s: int = 60
    max_bloques: int = 2000
    max_filas: int = 10000

    # Tamaño máximo de un archivo de entrada, en bytes.
    @property
    def max_bytes(self) -> int:
        return self.max_mb * 1024 * 1024


# Carpeta de trabajo por defecto según XDG_DATA_HOME o ~/.local/share.
def _carpeta_por_defecto() -> Path:
    base = os.environ.get("XDG_DATA_HOME", "").strip()
    raiz = Path(base) if base else Path("~/.local/share")
    return raiz / "convertitodo-mcp"


# Construye el error de una variable inválida con el problema y un ejemplo válido.
def _error(variable: str, problema: str, ejemplo: str) -> ErrorConfiguracion:
    return ErrorConfiguracion(
        f"La variable de entorno {variable} no es válida: {problema}.",
        f"definí {variable} con un valor válido, por ejemplo {variable}={ejemplo}.",
    )


# Lee un entero con mínimo y máximo opcional, o devuelve el valor por defecto.
def _entero(
    entorno: Mapping[str, str],
    variable: str,
    defecto: int,
    minimo: int,
    maximo: int | None,
    ejemplo: str,
) -> int:
    crudo = entorno.get(variable)
    if crudo is None or not crudo.strip():
        return defecto
    try:
        valor = int(crudo.strip())
    except ValueError:
        raise _error(variable, "debe ser un número entero", ejemplo) from None
    if valor < minimo or (maximo is not None and valor > maximo):
        rango = (
            f"entre {minimo} y {maximo}" if maximo is not None else f"mayor o igual que {minimo}"
        )
        raise _error(variable, f"debe estar {rango}", ejemplo)
    return valor


# Lee el token: vacío es None y si viene debe tener el largo mínimo.
def _token(entorno: Mapping[str, str]) -> SecretStr | None:
    crudo = entorno.get(_V_TOKEN)
    if crudo is None or not crudo.strip():
        return None
    valor = crudo.strip()
    if len(valor) < _LARGO_MINIMO_TOKEN:
        raise _error(
            _V_TOKEN,
            f"debe tener al menos {_LARGO_MINIMO_TOKEN} caracteres",
            "un texto aleatorio largo, de 32 caracteres o más",
        )
    return SecretStr(valor)


# Carga y valida la configuración desde el entorno indicado o desde os.environ.
def cargar_configuracion(entorno: Mapping[str, str] | None = None) -> Configuracion:
    origen: Mapping[str, str] = os.environ if entorno is None else entorno

    desconocidas = sorted(
        nombre
        for nombre in origen
        if nombre.startswith(PREFIJO) and nombre not in _VARIABLES_VALIDAS
    )
    if desconocidas:
        raise ErrorConfiguracion(
            f"Variable de entorno desconocida: {', '.join(desconocidas)}.",
            "corregí el nombre usando una de las variables válidas: "
            f"{', '.join(_VARIABLES_VALIDAS)}.",
        )

    transporte = origen.get(_V_TRANSPORTE, "").strip() or "stdio"
    if transporte not in ("stdio", "http"):
        raise _error(_V_TRANSPORTE, "debe ser 'stdio' o 'http'", "http")

    host = origen.get(_V_HOST)
    if host is None:
        host = "127.0.0.1"
    elif not host.strip():
        raise _error(_V_HOST, "no puede estar vacía", "127.0.0.1")
    host = host.strip()

    crudo_carpeta = origen.get(_V_CARPETA, "").strip()
    carpeta = Path(crudo_carpeta) if crudo_carpeta else _carpeta_por_defecto()
    carpeta = carpeta.expanduser().absolute()

    return Configuracion(
        transporte="http" if transporte == "http" else "stdio",
        host=host,
        puerto=_entero(origen, _V_PUERTO, 8765, 1, 65535, "8765"),
        token=_token(origen),
        carpeta_trabajo=carpeta,
        ttl_minutos=_entero(origen, _V_TTL, 60, 1, None, "60"),
        max_mb=_entero(origen, _V_MAX_MB, 25, 1, None, "25"),
        timeout_s=_entero(origen, _V_TIMEOUT, 60, 1, None, "60"),
        max_bloques=_entero(origen, _V_BLOQUES, 2000, 1, None, "2000"),
        max_filas=_entero(origen, _V_FILAS, 10000, 1, None, "10000"),
    )
