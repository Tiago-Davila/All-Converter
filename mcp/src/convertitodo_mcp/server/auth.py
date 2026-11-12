"""Autenticación por token Bearer obligatoria para el transporte HTTP."""

from __future__ import annotations

import hmac

from fastmcp.server.auth import AccessToken, TokenVerifier
from starlette.requests import Request
from starlette.responses import JSONResponse

from convertitodo_mcp.errores import ErrorConfiguracion
from convertitodo_mcp.server.config import PREFIJO, Configuracion

VARIABLE_TOKEN = PREFIJO + "TOKEN"

_ID_CLIENTE = "convertitodo"
_HOSTS_ABIERTOS = frozenset({"0.0.0.0", "::", "[::]", "*"})  # noqa: S104
_COMANDO_GENERAR = 'python -c "import secrets; print(secrets.token_urlsafe(32))"'


# Compara dos textos en tiempo constante trabajando sobre bytes.
def _iguales(recibido: str, esperado: str) -> bool:
    return hmac.compare_digest(recibido.encode("utf-8"), esperado.encode("utf-8"))


# Verificador que acepta únicamente el token configurado.
class VerificadorToken(TokenVerifier):
    # Guarda el token esperado sin exponerlo en la representación del objeto.
    def __init__(self, token: str) -> None:
        super().__init__()
        self._token = token

    # Oculta el token en repr.
    def __repr__(self) -> str:
        return "VerificadorToken(token=***)"

    # Acepta solo el token exacto, comparado en tiempo constante.
    async def verify_token(self, token: str) -> AccessToken | None:
        if not _iguales(token, self._token):
            return None
        return AccessToken(token=token, client_id=_ID_CLIENTE, scopes=[], expires_at=None)


# Indica si el host escucha en todas las interfaces de red.
def _host_abierto(host: str) -> bool:
    limpio = host.strip()
    return not limpio or limpio in _HOSTS_ABIERTOS


# Falla si el transporte HTTP se pide sin token; stdio nunca lo exige.
def validar_arranque(config: Configuracion) -> None:
    if config.transporte != "http" or config.token is not None:
        return
    exposicion = (
        f" El host '{config.host}' escucha en todas las interfaces: nunca se expone el "
        "servidor a la red sin token."
        if _host_abierto(config.host)
        else ""
    )
    raise ErrorConfiguracion(
        f"El transporte HTTP exige un token y {VARIABLE_TOKEN} no está definida.{exposicion}",
        f"generá un token con `{_COMANDO_GENERAR}`, exportalo como {VARIABLE_TOKEN} "
        "(mínimo 16 caracteres) y volvé a arrancar; los clientes lo envían en la cabecera "
        "Authorization: Bearer <token>.",
    )


# Crea el verificador del token configurado, o None si no hay token.
def crear_verificador(config: Configuracion) -> TokenVerifier | None:
    if config.token is None:
        return None
    return VerificadorToken(config.token.get_secret_value())


# Comprueba la cabecera Authorization: Bearer de una petición a una ruta propia.
def peticion_autorizada(request: Request, config: Configuracion) -> bool:
    if config.token is None:
        return False
    cabecera = request.headers.get("authorization", "")
    esquema, separador, recibido = cabecera.partition(" ")
    if not separador or esquema.lower() != "bearer" or not recibido:
        return False
    return _iguales(recibido, config.token.get_secret_value())


# Respuesta 401 uniforme para peticiones sin token válido.
def respuesta_no_autorizada() -> JSONResponse:
    return JSONResponse(
        {
            "error": "no_autorizado",
            "mensaje": (
                "Falta el token o es inválido. Enviá la cabecera "
                "Authorization: Bearer <token> con el valor de "
                f"{VARIABLE_TOKEN} del servidor."
            ),
        },
        status_code=401,
        headers={"WWW-Authenticate": "Bearer"},
    )
