"""Errores en español pensados para el modelo y su conversión a errores de herramienta."""

from __future__ import annotations

import functools
import inspect
from collections.abc import Awaitable, Callable
from typing import ClassVar, cast, overload

from fastmcp.exceptions import ToolError
from pydantic import ValidationError

_MENSAJE_GENERICO = (
    "Error interno al ejecutar la herramienta. Cómo corregirlo: reintentá la llamada y, "
    "si el error persiste, revisá que los argumentos tengan el formato indicado en el "
    "esquema de la herramienta."
)


# Error base con qué falló y cómo corregirlo, redactado para un modelo de lenguaje.
class ErrorConvertiTodo(Exception):
    codigo: ClassVar[str] = "error"

    # Guarda el motivo del fallo y la sugerencia de corrección.
    def __init__(self, que_fallo: str, como_corregir: str) -> None:
        super().__init__(que_fallo, como_corregir)
        self.que_fallo = que_fallo
        self.como_corregir = como_corregir

    # Devuelve el texto completo que se le muestra al modelo.
    def mensaje_para_modelo(self) -> str:
        return f"{self.que_fallo} Cómo corregirlo: {self.como_corregir}"

    # Usa el mismo texto que el mensaje para el modelo.
    def __str__(self) -> str:
        return self.mensaje_para_modelo()


# Un argumento tiene un valor inválido.
class ErrorArgumento(ErrorConvertiTodo):
    codigo: ClassVar[str] = "argumento_invalido"


# El archivo indicado no existe.
class ErrorArchivoNoEncontrado(ErrorConvertiTodo):
    codigo: ClassVar[str] = "archivo_no_encontrado"


# La ruta indicada sale de los directorios permitidos.
class ErrorRutaInsegura(ErrorConvertiTodo):
    codigo: ClassVar[str] = "ruta_insegura"


# Se superó un límite de tamaño o cantidad.
class ErrorLimiteExcedido(ErrorConvertiTodo):
    codigo: ClassVar[str] = "limite_excedido"


# La operación tardó más del tiempo permitido.
class ErrorTiempoAgotado(ErrorConvertiTodo):
    codigo: ClassVar[str] = "tiempo_agotado"


# El formato pedido o recibido no está soportado.
class ErrorFormatoNoSoportado(ErrorConvertiTodo):
    codigo: ClassVar[str] = "formato_no_soportado"


# La configuración del servidor es inválida.
class ErrorConfiguracion(ErrorConvertiTodo):
    codigo: ClassVar[str] = "configuracion_invalida"


# La operación no está autorizada.
class ErrorNoAutorizado(ErrorConvertiTodo):
    codigo: ClassVar[str] = "no_autorizado"


# Traduce a español el tipo de error de pydantic usando su contexto.
def _explicar(tipo: str, ctx: dict[str, object] | None) -> str:
    ctx = ctx or {}
    if tipo == "missing":
        return "falta este campo obligatorio"
    if tipo == "extra_forbidden":
        return "este campo no existe, eliminalo"
    if tipo in {"literal_error", "enum"}:
        permitidos = ctx.get("expected") or ctx.get("permitted")
        return (
            f"valor no permitido (valores válidos: {permitidos})"
            if permitidos
            else ("valor no permitido")
        )
    limites = {
        "greater_than": ("debe ser mayor que", "gt"),
        "greater_than_equal": ("debe ser mayor o igual que", "ge"),
        "less_than": ("debe ser menor que", "lt"),
        "less_than_equal": ("debe ser menor o igual que", "le"),
        "string_too_short": ("debe tener como mínimo caracteres:", "min_length"),
        "string_too_long": ("debe tener como máximo caracteres:", "max_length"),
        "too_short": ("debe tener como mínimo elementos:", "min_length"),
        "too_long": ("debe tener como máximo elementos:", "max_length"),
    }
    if tipo in limites:
        texto, clave = limites[tipo]
        return f"valor fuera de rango: {texto} {ctx.get(clave)}"
    if tipo.endswith("_type") or tipo.endswith("_parsing"):
        return "tipo de dato incorrecto"
    return "valor inválido"


# Convierte un ValidationError en un mensaje en español que lista cada campo con problema.
def _mensaje_validacion(exc: ValidationError) -> str:
    lineas: list[str] = []
    for error in exc.errors(include_url=False, include_input=False):
        ubicacion = ".".join(str(parte) for parte in error["loc"]) or "(argumentos)"
        ctx = cast("dict[str, object] | None", error.get("ctx"))
        lineas.append(f"- {ubicacion}: {_explicar(error['type'], ctx)}")
    detalle = "\n".join(lineas)
    return (
        f"Los argumentos no son válidos:\n{detalle}\n"
        "Cómo corregirlo: corregí cada campo indicado según el esquema de la herramienta "
        "y volvé a llamarla."
    )


# Convierte cualquier excepción en un ToolError con un mensaje seguro y útil para el modelo.
def a_error_de_herramienta(exc: BaseException) -> ToolError:
    if isinstance(exc, ToolError):
        return exc
    if isinstance(exc, ErrorConvertiTodo):
        return ToolError(exc.mensaje_para_modelo())
    if isinstance(exc, ValidationError):
        return ToolError(_mensaje_validacion(exc))
    return ToolError(_MENSAJE_GENERICO)


@overload
def herramienta_segura[**P, R](funcion: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]: ...


@overload
def herramienta_segura[**P, R](funcion: Callable[P, R]) -> Callable[P, R]: ...


# Decorador que traduce cualquier excepción de la herramienta a un ToolError claro.
def herramienta_segura[**P](funcion: Callable[P, object]) -> Callable[P, object]:
    if inspect.iscoroutinefunction(funcion):

        @functools.wraps(funcion)
        async def envoltura_async(*args: P.args, **kwargs: P.kwargs) -> object:
            try:
                return await cast("Callable[P, Awaitable[object]]", funcion)(*args, **kwargs)
            except Exception as exc:
                raise a_error_de_herramienta(exc) from None

        return envoltura_async

    @functools.wraps(funcion)
    def envoltura(*args: P.args, **kwargs: P.kwargs) -> object:
        try:
            return funcion(*args, **kwargs)
        except Exception as exc:
            raise a_error_de_herramienta(exc) from None

    return envoltura
