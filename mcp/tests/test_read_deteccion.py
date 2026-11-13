"""Detección por contenido y protección de paquetes OOXML."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado, ErrorLimiteExcedido
from convertitodo_mcp.read.deteccion import cargar_entrada, detectar_tipo
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen


@pytest.mark.parametrize(
    ("fixture", "tipo"),
    [("text.pdf", "pdf"), ("sample.docx", "docx"), ("sample.xlsx", "xlsx"), ("sample.csv", "csv")],
)
def test_detecta_fixtures(fixture_bytes: Callable[[str], bytes], fixture: str, tipo: str) -> None:
    assert detectar_tipo(fixture_bytes(fixture), fixture) == tipo


def test_firma_prevalece_sobre_extension(fixture_bytes: Callable[[str], bytes]) -> None:
    assert detectar_tipo(fixture_bytes("text.pdf"), "archivo.csv") == "pdf"
    with pytest.raises(ErrorFormatoNoSoportado):
        detectar_tipo(fixture_bytes("sample.png"), "archivo.csv")


def _paquete(extra: dict[str, bytes]) -> bytes:
    salida = BytesIO()
    with ZipFile(salida, "w", ZIP_DEFLATED) as paquete:
        paquete.writestr("[Content_Types].xml", b"<Types/>")
        paquete.writestr("_rels/.rels", b"<Relationships/>")
        paquete.writestr("ppt/presentation.xml", b"<presentation/>")
        for nombre, contenido in extra.items():
            paquete.writestr(nombre, contenido)
    return salida.getvalue()


def test_detecta_pptx_y_html() -> None:
    assert detectar_tipo(_paquete({}), "archivo.zip") == "pptx"
    assert detectar_tipo(b"<html>hola</html>", "archivo.html") == "html"


@pytest.mark.parametrize(
    "extra",
    [
        {"ppt/evil.xml": b'<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>'},
        {"ppt/vbaProject.bin": b"macro"},
        {
            "ppt/_rels/presentation.xml.rels": (
                b'<Relationships><Relationship TargetMode="External"/></Relationships>'
            )
        },
        {"../evil.xml": b"<x/>"},
    ],
)
def test_rechaza_paquete_inseguro(tmp_path: Path, extra: dict[str, bytes]) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("entrada.pptx", _paquete(extra))
    with pytest.raises(ErrorFormatoNoSoportado):
        cargar_entrada(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path))


def test_limita_expansion(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida(
        "entrada.pptx", _paquete({"ppt/large.xml": b" " * (1024 * 1024 + 1)})
    )
    with pytest.raises(ErrorLimiteExcedido):
        cargar_entrada(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path, max_mb=1))


def test_html_por_contenido_y_archivo_vacio() -> None:
    assert detectar_tipo(b"  <!DOCTYPE html><html></html>", "entrada.csv") == "html"
    assert detectar_tipo(b"<body>hola</body>", "entrada.bin") == "html"
    with pytest.raises(ErrorArgumento, match="vacío"):
        detectar_tipo(b"", "entrada.csv")


@pytest.mark.parametrize("esquema", ["https", "http", "mailto"])
def test_acepta_hipervinculos_inertes(tmp_path: Path, esquema: str) -> None:
    relacion = (
        '<Relationships><Relationship TargetMode="External" '
        f'Type="https://schemas.example/hyperlink" Target="{esquema}:destino"/>'
        "</Relationships>"
    ).encode()
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida(
        "entrada.pptx", _paquete({"ppt/_rels/presentation.xml.rels": relacion})
    )
    assert (
        cargar_entrada(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path)).tipo == "pptx"
    )


def test_rechaza_hipervinculo_con_esquema_activo(tmp_path: Path) -> None:
    relacion = (
        b'<Relationships><Relationship TargetMode="External" '
        b'Type="https://schemas.example/hyperlink" Target="file:///etc/passwd"/>'
        b"</Relationships>"
    )
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida(
        "entrada.pptx", _paquete({"ppt/_rels/presentation.xml.rels": relacion})
    )
    with pytest.raises(ErrorFormatoNoSoportado):
        cargar_entrada(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path))


def _xlsx_con_tipos(tipos: bytes, extra: dict[str, bytes]) -> bytes:
    salida = BytesIO()
    with ZipFile(salida, "w", ZIP_DEFLATED) as paquete:
        paquete.writestr("[Content_Types].xml", tipos)
        paquete.writestr("_rels/.rels", b"<Relationships/>")
        paquete.writestr("xl/workbook.xml", b"<workbook/>")
        for nombre, contenido in extra.items():
            paquete.writestr(nombre, contenido)
    return salida.getvalue()


_MACRO = b"application/vnd.ms-excel.sheet.binary.macroEnabled.main"


def test_acepta_tipo_macro_por_defecto_sin_partes(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path)
    # multisheet.xlsx declara .bin como macro por defecto, pero no tiene partes .bin.
    for datos in (
        fixture_bytes("multisheet.xlsx"),
        _xlsx_con_tipos(
            b'<Types><Default Extension="bin" ContentType="' + _MACRO + b'"/></Types>', {}
        ),
    ):
        archivo = almacen.guardar_subida("libro.xlsx", datos)
        assert cargar_entrada(archivo.id, almacen, config).tipo == "xlsx"


@pytest.mark.parametrize(
    ("tipos", "extra"),
    [
        (
            b'<Types><Default Extension="dat" ContentType="' + _MACRO + b'"/></Types>',
            {"xl/macro.dat": b"x"},
        ),
        (
            b'<Types><Override PartName="/xl/workbook.xml" ContentType="' + _MACRO + b'"/></Types>',
            {},
        ),
    ],
)
def test_rechaza_tipos_macro_usados(tmp_path: Path, tipos: bytes, extra: dict[str, bytes]) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("libro.xlsx", _xlsx_con_tipos(tipos, extra))
    with pytest.raises(ErrorFormatoNoSoportado):
        cargar_entrada(archivo.id, almacen, Configuracion(carpeta_trabajo=tmp_path))
