"""Saneado de nombres, validación de ids y resolución segura de rutas contra path traversal."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from convertitodo_mcp.errores import ErrorArgumento, ErrorRutaInsegura

LARGO_MAXIMO_NOMBRE = 120

_LARGO_MAXIMO_EXTENSION = 20
_NOMBRE_POR_DEFECTO = "archivo"
_CARACTERES_PROBLEMATICOS = re.compile(r'[<>:"|?*]')
_SEPARADORES = re.compile(r"[/\\]")
_UNIDAD_WINDOWS = re.compile(r"^[A-Za-z]:")
_ID_VALIDO = re.compile(r"[A-Za-z0-9_-]{16,64}")
_RESERVADOS_WINDOWS = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{n}" for n in range(1, 10)}
    | {f"LPT{n}" for n in range(1, 10)}
)

_AYUDA_RUTA = "usá solo nombres de archivo relativos simples, sin '..', sin '\\' y sin symlinks."


# Devuelve un nombre de archivo seguro para mostrar y guardar; nunca lanza por contenido raro.
def sanear_nombre(nombre: str) -> str:
    texto = unicodedata.normalize("NFC", nombre)
    segmentos = [s for s in _SEPARADORES.split(texto) if s]
    texto = segmentos[-1] if segmentos else ""
    texto = "".join(c for c in texto if unicodedata.category(c) != "Cc")
    texto = _CARACTERES_PROBLEMATICOS.sub("_", texto)
    texto = texto.strip(". ")
    if not texto:
        return _NOMBRE_POR_DEFECTO
    if texto.split(".", 1)[0].rstrip(" ").upper() in _RESERVADOS_WINDOWS:
        texto = f"_{texto}"
    if len(texto) > LARGO_MAXIMO_NOMBRE:
        texto = _recortar(texto)
    return texto or _NOMBRE_POR_DEFECTO


# Recorta al largo máximo conservando la extensión cuando es razonable.
def _recortar(texto: str) -> str:
    punto = texto.rfind(".")
    extension = texto[punto:] if punto > 0 else ""
    if len(extension) > _LARGO_MAXIMO_EXTENSION:
        extension = ""
    raiz = texto[: LARGO_MAXIMO_NOMBRE - len(extension)].rstrip(". ")
    return (raiz + extension).strip(". ")


# Indica si es un id opaco con el formato de secrets.token_urlsafe.
def es_id_valido(identificador: str) -> bool:
    return _ID_VALIDO.fullmatch(identificador) is not None


# Devuelve el id o lanza ErrorArgumento sin repetir el valor recibido.
def validar_id(identificador: str) -> str:
    if not es_id_valido(identificador):
        raise ErrorArgumento(
            "El identificador recibido no es válido.",
            "usá exactamente el id que devolvió la herramienta anterior "
            "(entre 16 y 64 caracteres: letras, números, '-' y '_').",
        )
    return identificador


# Verifica que ningún componente existente entre base y destino sea un symlink.
def _rechazar_symlinks(base_real: Path, partes: tuple[str, ...]) -> None:
    actual = base_real
    for parte in partes:
        actual = actual / parte
        if actual.is_symlink():
            raise ErrorRutaInsegura(
                "La ruta contiene un enlace simbólico, que no está permitido.", _AYUDA_RUTA
            )


# Confirma que la ruta resuelta queda dentro de la base resuelta.
def _confirmar_contencion(base_real: Path, destino: Path) -> Path:
    resuelta = destino.resolve()
    if not resuelta.is_relative_to(base_real):
        raise ErrorRutaInsegura("La ruta sale del directorio permitido.", _AYUDA_RUTA)
    return resuelta


# Devuelve la ruta absoluta de relativa dentro de base o lanza ErrorRutaInsegura.
def resolver_dentro(base: Path, relativa: str | Path) -> Path:
    # TOCTOU: se verifica al resolver; quien abre el archivo debe usar la ruta devuelta.
    texto = str(relativa)
    if not texto.strip():
        raise ErrorRutaInsegura("La ruta está vacía.", _AYUDA_RUTA)
    if "\x00" in texto:
        raise ErrorRutaInsegura("La ruta contiene caracteres no permitidos.", _AYUDA_RUTA)
    if "\\" in texto:
        raise ErrorRutaInsegura("La ruta contiene el separador '\\', no permitido.", _AYUDA_RUTA)
    if texto.startswith("/") or _UNIDAD_WINDOWS.match(texto):
        raise ErrorRutaInsegura("No se permiten rutas absolutas.", _AYUDA_RUTA)
    partes = tuple(p for p in texto.split("/") if p not in ("", "."))
    if not partes:
        raise ErrorRutaInsegura("La ruta no apunta a ningún archivo.", _AYUDA_RUTA)
    if ".." in partes:
        raise ErrorRutaInsegura("La ruta contiene '..', no permitido.", _AYUDA_RUTA)
    base_real = base.resolve()
    _rechazar_symlinks(base_real, partes)
    return _confirmar_contencion(base_real, base_real.joinpath(*partes))


# Resuelve una ruta ya armada y confirma que está dentro de base, sin symlinks en el tramo.
def asegurar_dentro(base: Path, ruta: Path) -> Path:
    base_real = base.resolve()
    absoluta = ruta if ruta.is_absolute() else base_real / ruta
    if ".." in absoluta.parts:
        raise ErrorRutaInsegura("La ruta contiene '..', no permitido.", _AYUDA_RUTA)
    for raiz in (base_real, base.absolute()):
        if absoluta.is_relative_to(raiz):
            _rechazar_symlinks(base_real, absoluta.relative_to(raiz).parts)
            break
    return _confirmar_contencion(base_real, absoluta)
