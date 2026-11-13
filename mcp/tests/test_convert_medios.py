"""Pruebas de conversión de audio y extracción desde MP4 con ffmpeg."""

from __future__ import annotations

import io
import subprocess
import wave
from collections.abc import Callable
from pathlib import Path

import pytest

from convertitodo_mcp.convert import medios
from convertitodo_mcp.convert.medios import (
    convertir_audio,
    detectar_medio,
    extraer_audio,
    ffmpeg_disponible,
)
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorTiempoAgotado,
)

necesita_ffmpeg = pytest.mark.skipif(ffmpeg_disponible() is None, reason="ffmpeg no está instalado")


def _wav_corto() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 4000)
    return buf.getvalue()


def _sin_ffmpeg(*_a: object, **_k: object) -> subprocess.CompletedProcess[bytes]:
    raise AssertionError("no debía invocarse ffmpeg")


def test_detectar_medio_fixtures(fixture_bytes: Callable[[str], bytes]) -> None:
    assert detectar_medio(fixture_bytes("sample.mp3")) == "mp3"
    assert detectar_medio(fixture_bytes("sample.mp4")) == "mp4"
    assert detectar_medio(fixture_bytes("silent.mp4")) == "mp4"
    assert detectar_medio(_wav_corto()) == "wav"
    assert detectar_medio(b"OggS" + b"\x00" * 20) == "ogg"
    assert detectar_medio(b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00") == "m4a"


def test_detectar_medio_desconocido(fixture_bytes: Callable[[str], bytes]) -> None:
    assert detectar_medio(fixture_bytes("text.pdf")) is None
    assert detectar_medio(b"") is None


def test_entrada_invalida_no_invoca_ffmpeg(
    monkeypatch: pytest.MonkeyPatch, fixture_bytes: Callable[[str], bytes]
) -> None:
    monkeypatch.setattr(subprocess, "run", _sin_ffmpeg)
    with pytest.raises(ErrorFormatoNoSoportado):
        convertir_audio(fixture_bytes("text.pdf"), "wav")
    with pytest.raises(ErrorFormatoNoSoportado):
        convertir_audio(b"\x01\x02\x03azar", "mp3")
    with pytest.raises(ErrorFormatoNoSoportado):
        extraer_audio(fixture_bytes("sample.mp3"))
    with pytest.raises(ErrorArgumento):
        convertir_audio(fixture_bytes("sample.mp3"), "mp3")


def test_ffmpeg_ausente(
    monkeypatch: pytest.MonkeyPatch, fixture_bytes: Callable[[str], bytes]
) -> None:
    monkeypatch.setattr(medios, "ffmpeg_disponible", lambda: None)
    with pytest.raises(ErrorFormatoNoSoportado, match="ffmpeg instalado"):
        convertir_audio(fixture_bytes("sample.mp3"), "wav")


def test_timeout(monkeypatch: pytest.MonkeyPatch, fixture_bytes: Callable[[str], bytes]) -> None:
    def agotar(*_a: object, **_k: object) -> subprocess.CompletedProcess[bytes]:
        raise subprocess.TimeoutExpired("ffmpeg", 1)

    monkeypatch.setattr(medios, "ffmpeg_disponible", lambda: "/usr/bin/ffmpeg")
    monkeypatch.setattr(subprocess, "run", agotar)
    with pytest.raises(ErrorTiempoAgotado):
        convertir_audio(fixture_bytes("sample.mp3"), "wav")


def test_fallo_generico_no_filtra_rutas(
    monkeypatch: pytest.MonkeyPatch, fixture_bytes: Callable[[str], bytes]
) -> None:
    secreto = "/var/directorio-secreto/entrada.bin"

    def fallar(args: list[str], **_k: object) -> subprocess.CompletedProcess[bytes]:
        salida = b"pcm_s16le" if "-encoders" in args else b""
        return subprocess.CompletedProcess(args, 1, salida, secreto.encode())

    monkeypatch.setattr(medios, "ffmpeg_disponible", lambda: "/usr/bin/ffmpeg")
    monkeypatch.setattr(subprocess, "run", fallar)
    with pytest.raises(ErrorFormatoNoSoportado) as info:
        convertir_audio(fixture_bytes("sample.mp3"), "wav")
    assert "secreto" not in str(info.value)
    assert "/var" not in str(info.value)


@necesita_ffmpeg
def test_extraer_audio_mp4(fixture_bytes: Callable[[str], bytes]) -> None:
    assert detectar_medio(extraer_audio(fixture_bytes("sample.mp4"))) == "mp3"


@necesita_ffmpeg
def test_extraer_audio_sin_pista(fixture_bytes: Callable[[str], bytes]) -> None:
    with pytest.raises(ErrorArgumento, match="no tiene audio"):
        extraer_audio(fixture_bytes("silent.mp4"))


@necesita_ffmpeg
def test_mp3_a_wav_ogg_m4a_y_wav_a_mp3(fixture_bytes: Callable[[str], bytes]) -> None:
    wav = convertir_audio(fixture_bytes("sample.mp3"), "wav")
    with wave.open(io.BytesIO(wav)) as w:
        assert w.getnframes() / w.getframerate() > 0
    assert detectar_medio(convertir_audio(wav, "ogg")) == "ogg"
    assert detectar_medio(convertir_audio(wav, "m4a")) == "m4a"
    assert detectar_medio(convertir_audio(wav, "mp3")) == "mp3"


@necesita_ffmpeg
def test_sin_directorios_temporales(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    monkeypatch.setattr("tempfile.tempdir", str(tmp_path))
    convertir_audio(fixture_bytes("sample.mp3"), "wav")
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(ErrorArgumento):
        extraer_audio(fixture_bytes("silent.mp4"))
    assert list(tmp_path.iterdir()) == []
