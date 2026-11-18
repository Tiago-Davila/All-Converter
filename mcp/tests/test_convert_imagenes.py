"""Pruebas de la conversión de imágenes PNG/JPG/WebP."""

import io
from collections.abc import Callable

import pytest
from PIL import Image

from convertitodo_mcp.convert import imagenes
from convertitodo_mcp.convert.imagenes import (
    FormatoImagen,
    abrir_imagen,
    aplanar_sobre_blanco,
    convertir_imagen,
    detectar_formato_imagen,
)
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
)

Fixture = Callable[[str], bytes]

_NOMBRES_PILLOW = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}


def _guardar(imagen: Image.Image, formato: str, **opciones: object) -> bytes:
    salida = io.BytesIO()
    imagen.save(salida, formato, **opciones)
    return salida.getvalue()


def _entrada(fixture_bytes: Fixture, formato: FormatoImagen) -> bytes:
    png = fixture_bytes("sample.png")
    if formato == "png":
        return png
    base = Image.open(io.BytesIO(png)).convert("RGB")
    return _guardar(base, _NOMBRES_PILLOW[formato])


@pytest.mark.parametrize(
    ("origen", "destino"),
    [
        ("png", "jpg"),
        ("png", "webp"),
        ("jpg", "png"),
        ("jpg", "webp"),
        ("webp", "png"),
        ("webp", "jpg"),
    ],
)
def test_conversiones_cruzadas(
    fixture_bytes: Fixture, origen: FormatoImagen, destino: FormatoImagen
) -> None:
    resultado = convertir_imagen(_entrada(fixture_bytes, origen), destino)
    leida = Image.open(io.BytesIO(resultado))
    assert leida.format == _NOMBRES_PILLOW[destino]
    assert leida.size == (400, 300)
    assert leida.mode == "RGB"


def test_mismo_formato_recomprime(fixture_bytes: Fixture) -> None:
    resultado = convertir_imagen(_entrada(fixture_bytes, "jpg"), "jpg", calidad=20)
    assert Image.open(io.BytesIO(resultado)).format == "JPEG"


def test_png_con_paleta_se_convierte(fixture_bytes: Fixture) -> None:
    resultado = convertir_imagen(fixture_bytes("images.png"), "jpg")
    leida = Image.open(io.BytesIO(resultado))
    assert leida.format == "JPEG"
    assert leida.size == (447, 447)
    assert leida.mode == "RGB"


def test_transparencia_se_aplana_sobre_blanco_en_jpg() -> None:
    rgba = Image.new("RGBA", (4, 4), (255, 0, 0, 0))
    rgba.putpixel((1, 1), (0, 0, 255, 255))
    resultado = convertir_imagen(_guardar(rgba, "PNG"), "jpg", calidad=100)
    leida = Image.open(io.BytesIO(resultado))
    assert leida.mode == "RGB"
    transparente = leida.getpixel((3, 3))
    assert isinstance(transparente, tuple)
    assert all(canal >= 250 for canal in transparente)


def test_aplanar_sobre_blanco_exacto() -> None:
    rgba = Image.new("RGBA", (2, 1), (10, 20, 30, 0))
    rgba.putpixel((1, 0), (10, 20, 30, 255))
    plano = aplanar_sobre_blanco(rgba)
    assert plano.mode == "RGB"
    assert plano.getpixel((0, 0)) == (255, 255, 255)
    assert plano.getpixel((1, 0)) == (10, 20, 30)


def test_aplanar_paleta_con_transparencia() -> None:
    paleta = Image.new("P", (2, 1), 0)
    paleta.putpalette([255, 0, 0, 0, 255, 0] + [0] * 762)
    paleta.putpixel((1, 0), 1)
    paleta.info["transparency"] = 0
    plano = aplanar_sobre_blanco(paleta)
    assert plano.getpixel((0, 0)) == (255, 255, 255)
    assert plano.getpixel((1, 0)) == (0, 255, 0)


@pytest.mark.parametrize("formato", ["png", "webp"])
def test_png_y_webp_conservan_alfa(formato: FormatoImagen) -> None:
    rgba = Image.new("RGBA", (4, 4), (255, 0, 0, 0))
    resultado = convertir_imagen(_guardar(rgba, "PNG"), formato)
    leida = Image.open(io.BytesIO(resultado))
    assert leida.mode == "RGBA"
    assert leida.getpixel((0, 0))[3] == 0  # type: ignore[index]


def test_ancho_maximo_reduce_conservando_proporcion(fixture_bytes: Fixture) -> None:
    resultado = convertir_imagen(fixture_bytes("sample.png"), "png", ancho_maximo=200)
    assert Image.open(io.BytesIO(resultado)).size == (200, 150)


def test_ancho_maximo_no_agranda(fixture_bytes: Fixture) -> None:
    resultado = convertir_imagen(fixture_bytes("sample.png"), "webp", ancho_maximo=5000)
    assert Image.open(io.BytesIO(resultado)).size == (400, 300)


def test_calidad_baja_pesa_menos_que_alta() -> None:
    ruido = Image.effect_noise((200, 200), 80).convert("RGB")
    png = _guardar(ruido, "PNG")
    baja = convertir_imagen(png, "jpg", calidad=10)
    alta = convertir_imagen(png, "jpg", calidad=95)
    assert len(baja) < len(alta)


def test_orientacion_exif_se_aplica_y_no_queda_exif() -> None:
    base = Image.new("RGB", (40, 20), (200, 10, 10))
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x010F] = "Camara"
    jpeg = _guardar(base, "JPEG", exif=exif)
    assert Image.open(io.BytesIO(jpeg)).size == (40, 20)
    assert abrir_imagen(jpeg).size == (20, 40)
    for formato in ("jpg", "png", "webp"):
        resultado = convertir_imagen(jpeg, formato)
        leida = Image.open(io.BytesIO(resultado))
        assert leida.size == (20, 40)
        assert len(leida.getexif()) == 0


def test_detectar_formato(fixture_bytes: Fixture) -> None:
    assert detectar_formato_imagen(_entrada(fixture_bytes, "png")) == "png"
    assert detectar_formato_imagen(_entrada(fixture_bytes, "jpg")) == "jpg"
    assert detectar_formato_imagen(_entrada(fixture_bytes, "webp")) == "webp"
    assert detectar_formato_imagen(fixture_bytes("text.pdf")) is None
    assert detectar_formato_imagen(b"") is None


def test_webp_animado_se_rechaza(fixture_bytes: Fixture) -> None:
    with pytest.raises(ErrorFormatoNoSoportado, match="animado"):
        convertir_imagen(fixture_bytes("animated.webp"), "png")


def test_abrir_webp_animado_usa_primer_cuadro(fixture_bytes: Fixture) -> None:
    assert abrir_imagen(fixture_bytes("animated.webp")).size == (200, 200)


def test_bytes_vacios() -> None:
    with pytest.raises(ErrorFormatoNoSoportado):
        convertir_imagen(b"", "png")


def test_pdf_como_imagen(fixture_bytes: Fixture) -> None:
    with pytest.raises(ErrorFormatoNoSoportado):
        convertir_imagen(fixture_bytes("corrupt.pdf"), "png")


def test_png_truncado(fixture_bytes: Fixture) -> None:
    png = fixture_bytes("sample.png")
    with pytest.raises(ErrorFormatoNoSoportado, match="dañada"):
        convertir_imagen(png[: len(png) // 2], "jpg")


def test_firma_valida_con_cuerpo_corrupto() -> None:
    with pytest.raises(ErrorFormatoNoSoportado):
        abrir_imagen(b"\x89PNG\r\n\x1a\n" + b"basura" * 10)


def test_imagen_supera_max_pixeles(fixture_bytes: Fixture, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(imagenes, "MAX_PIXELES", 1000)
    with pytest.raises(ErrorLimiteExcedido, match="megapíxeles"):
        convertir_imagen(fixture_bytes("sample.png"), "png")
    with pytest.raises(ErrorLimiteExcedido):
        abrir_imagen(fixture_bytes("sample.png"))


def test_imagen_supera_max_lado(fixture_bytes: Fixture, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(imagenes, "MAX_LADO", 100)
    with pytest.raises(ErrorLimiteExcedido):
        abrir_imagen(fixture_bytes("sample.png"))


@pytest.mark.parametrize("calidad", [0, 101, -5])
def test_calidad_fuera_de_rango(fixture_bytes: Fixture, calidad: int) -> None:
    with pytest.raises(ErrorArgumento, match="1 y 100"):
        convertir_imagen(fixture_bytes("sample.png"), "jpg", calidad=calidad)


def test_ancho_maximo_invalido(fixture_bytes: Fixture) -> None:
    with pytest.raises(ErrorArgumento):
        convertir_imagen(fixture_bytes("sample.png"), "png", ancho_maximo=0)


def test_formato_de_salida_invalido(fixture_bytes: Fixture) -> None:
    with pytest.raises(ErrorArgumento):
        convertir_imagen(fixture_bytes("sample.png"), "gif")  # type: ignore[arg-type]
