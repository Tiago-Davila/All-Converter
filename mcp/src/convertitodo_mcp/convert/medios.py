"""Conversión de audio y extracción de audio de MP4 con ffmpeg (opcional)."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Final, Literal

from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorTiempoAgotado,
)

FormatoAudio = Literal["mp3", "wav", "ogg", "m4a"]
FormatoMedio = Literal["mp3", "wav", "ogg", "m4a", "mp4"]

MAX_DURACION_S: Final = 3600
MAX_SALIDA_BYTES: Final = 200 * 1024 * 1024

_FORMATOS_AUDIO: Final[tuple[str, ...]] = ("mp3", "wav", "ogg", "m4a")
# Demuxer forzado por formato detectado: m4a y mp4 comparten el demuxer mov.
_DEMUXER: Final[dict[str, str]] = {
    "mp3": "mp3",
    "wav": "wav",
    "ogg": "ogg",
    "m4a": "mov",
    "mp4": "mov",
}
# Muxer de salida y opciones de códec; la app web usa mp3 con -q:a 2 y aac a 192k.
_SALIDA: Final[dict[str, tuple[str, list[str]]]] = {
    "mp3": ("mp3", ["-c:a", "libmp3lame", "-q:a", "2"]),
    "wav": ("wav", ["-c:a", "pcm_s16le"]),
    "ogg": ("ogg", ["-c:a", "libvorbis", "-q:a", "5"]),
    "m4a": ("ipod", ["-c:a", "aac", "-b:a", "192k"]),
}
_CODIFICADOR: Final[dict[str, str]] = {
    "mp3": "libmp3lame",
    "wav": "pcm_s16le",
    "ogg": "libvorbis",
    "m4a": "aac",
}
_MARCAS_M4A: Final = (b"M4A ", b"M4B ")


# Devuelve la ruta absoluta de ffmpeg si está instalado; las conversiones son opcionales.
def ffmpeg_disponible() -> str | None:
    return shutil.which("ffmpeg")


# Identifica el formato por su firma binaria, sin ejecutar nada.
def detectar_medio(datos: bytes) -> FormatoMedio | None:
    if datos[:3] == b"ID3":
        return "mp3"
    if len(datos) >= 12 and datos[:4] == b"RIFF" and datos[8:12] == b"WAVE":
        return "wav"
    if datos[:4] == b"OggS":
        return "ogg"
    if len(datos) >= 12 and datos[4:8] == b"ftyp":
        return "m4a" if datos[8:12] in _MARCAS_M4A else "mp4"
    # Sincronía de cuadro MPEG: 11 bits en 1, versión distinta de 01 y capa distinta de 00.
    if (
        len(datos) >= 2
        and datos[0] == 0xFF
        and datos[1] & 0xE0 == 0xE0
        and datos[1] & 0x18 != 0x08
        and datos[1] & 0x06 != 0x00
    ):
        return "mp3"
    return None


# Lista los codificadores de ffmpeg para fallar con claridad si falta el del destino.
def _verificar_codificador(ffmpeg: str, destino: FormatoAudio, tiempo_limite_s: float) -> None:
    try:
        # S603: ruta absoluta de ffmpeg_disponible() y argumentos fijos, sin shell.
        r = subprocess.run(  # noqa: S603
            [ffmpeg, "-nostdin", "-hide_banner", "-encoders"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=tiempo_limite_s,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise _tiempo_agotado() from exc
    palabras = r.stdout.decode("utf-8", "replace").split()
    if _CODIFICADOR[destino] not in palabras:
        raise ErrorFormatoNoSoportado(
            f"Este ffmpeg no incluye el codificador necesario para generar {destino.upper()}.",
            "Instalá una compilación de ffmpeg con soporte para ese códec o elegí otro formato.",
        )


def _tiempo_agotado() -> ErrorTiempoAgotado:
    return ErrorTiempoAgotado(
        "La conversión de audio tardó más del tiempo permitido.",
        "Probá con un archivo más corto o más liviano.",
    )


# Ejecuta ffmpeg en un directorio temporal propio; nunca expone stderr en los errores.
def _ejecutar(
    datos: bytes, origen: FormatoMedio, destino: FormatoAudio, tiempo_limite_s: float
) -> bytes:
    ffmpeg = ffmpeg_disponible()
    if ffmpeg is None:
        raise ErrorFormatoNoSoportado(
            "Las conversiones de audio y video requieren ffmpeg instalado en el servidor.",
            "Pedí a quien administra el servidor que instale ffmpeg y reintentá.",
        )
    _verificar_codificador(ffmpeg, destino, tiempo_limite_s)
    muxer, codec = _SALIDA[destino]
    with tempfile.TemporaryDirectory() as tmp:
        raiz = Path(tmp)
        entrada, salida = raiz / "entrada.bin", raiz / f"salida.{destino}"
        entrada.write_bytes(datos)
        # El demuxer forzado y la lista blanca de protocolos impiden que el archivo
        # arrastre a ffmpeg a leer otros archivos o la red (listas HLS, concat, etc.).
        args = [
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-protocol_whitelist", "file",
            "-f", _DEMUXER[origen], "-i", entrada.name,
            "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
            "-t", str(MAX_DURACION_S), "-fs", str(MAX_SALIDA_BYTES),
            *codec, "-f", muxer, salida.name,
        ]  # fmt: skip
        try:
            # S603: lista de argumentos con ruta absoluta, sin shell y entrada ya validada.
            r = subprocess.run(  # noqa: S603
                args,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=tiempo_limite_s,
                check=False,
                cwd=raiz,
            )
        except subprocess.TimeoutExpired as exc:
            raise _tiempo_agotado() from exc
        if r.returncode != 0:
            # Solo se interpreta stderr para detectar la falta de audio; no se copia al error.
            sin_audio = origen == "mp4" and b"matches no streams" in r.stderr
            if sin_audio:
                raise ErrorArgumento(
                    "El video no tiene audio que extraer.",
                    "Usá un video que contenga una pista de audio.",
                )
            raise ErrorFormatoNoSoportado(
                "No se pudo convertir el archivo: está dañado o su códec no está soportado.",
                "Verificá que el archivo sea un audio o video válido y reintentá.",
            )
        if not salida.is_file() or salida.stat().st_size == 0:
            raise ErrorFormatoNoSoportado(
                "La conversión no produjo audio.",
                "Verificá que el archivo contenga audio y reintentá.",
            )
        return salida.read_bytes()


def _validar_destino(destino: str) -> None:
    if destino not in _FORMATOS_AUDIO:
        raise ErrorArgumento(
            "El formato de destino no es válido.",
            f"Elegí uno de: {', '.join(_FORMATOS_AUDIO)}.",
        )


# Convierte entre MP3, WAV, OGG y M4A; como la app web, rechaza el mismo formato.
def convertir_audio(datos: bytes, destino: FormatoAudio, *, tiempo_limite_s: float = 120) -> bytes:
    _validar_destino(destino)
    origen = detectar_medio(datos)
    if origen is None or origen == "mp4":
        raise ErrorFormatoNoSoportado(
            "El archivo no es un audio MP3, WAV, OGG o M4A reconocible.",
            "Subí un audio en esos formatos; para un video MP4 usá la extracción de audio.",
        )
    if origen == destino:
        raise ErrorArgumento(
            f"El archivo ya está en formato {destino.upper()}.",
            "Elegí un formato de destino distinto al del archivo.",
        )
    return _ejecutar(datos, origen, destino, tiempo_limite_s)


# Extrae la primera pista de audio de un MP4; falla si el video no tiene audio.
def extraer_audio(
    datos: bytes, destino: FormatoAudio = "mp3", *, tiempo_limite_s: float = 120
) -> bytes:
    _validar_destino(destino)
    if detectar_medio(datos) != "mp4":
        raise ErrorFormatoNoSoportado(
            "El archivo no es un video MP4 reconocible.",
            "Subí un video MP4; para convertir un audio usá la conversión de audio.",
        )
    return _ejecutar(datos, "mp4", destino, tiempo_limite_s)
