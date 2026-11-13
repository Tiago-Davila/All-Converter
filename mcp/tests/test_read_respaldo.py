"""Lectura local de respaldo con documentos reales."""

from collections.abc import Callable
from pathlib import Path

import pytest

from convertitodo_mcp.errores import ErrorLimiteExcedido
from convertitodo_mcp.read.modelos import EntradaDocumento
from convertitodo_mcp.read.respaldo import leer_respaldo
from convertitodo_mcp.server.config import Configuracion


def test_pdf_conserva_paginas(fixture_bytes: Callable[[str], bytes], tmp_path: Path) -> None:
    entrada = EntradaDocumento("texto.pdf", "pdf", fixture_bytes("text.pdf"))
    resultado = leer_respaldo(entrada, Configuracion(carpeta_trabajo=tmp_path))
    assert resultado.paginas
    assert any(pagina.strip() for pagina in resultado.paginas)


def test_docx_conserva_tabla(fixture_bytes: Callable[[str], bytes], tmp_path: Path) -> None:
    entrada = EntradaDocumento("tabla.docx", "docx", fixture_bytes("table.docx"))
    resultado = leer_respaldo(entrada, Configuracion(carpeta_trabajo=tmp_path))
    assert "|" in resultado.paginas[0]
    assert "---" in resultado.paginas[0]


def test_xlsx_conserva_hojas(fixture_bytes: Callable[[str], bytes], tmp_path: Path) -> None:
    entrada = EntradaDocumento("hojas.xlsx", "xlsx", fixture_bytes("multisheet.xlsx"))
    resultado = leer_respaldo(entrada, Configuracion(carpeta_trabajo=tmp_path))
    assert len(resultado.hojas) > 1
    assert len(resultado.paginas) == len(resultado.hojas)
    assert any("|" in pagina for pagina in resultado.paginas)


def test_xlsx_limita_filas(fixture_bytes: Callable[[str], bytes], tmp_path: Path) -> None:
    entrada = EntradaDocumento("hojas.xlsx", "xlsx", fixture_bytes("multisheet.xlsx"))
    with pytest.raises(ErrorLimiteExcedido):
        leer_respaldo(entrada, Configuracion(carpeta_trabajo=tmp_path, max_filas=1))


def test_info_pdf_no_extrae_texto(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pypdf import PageObject

    from convertitodo_mcp.read.respaldo import info_basica

    def prohibido(*args: object, **kwargs: object) -> str:
        raise AssertionError("No debe extraer texto")

    monkeypatch.setattr(PageObject, "extract_text", prohibido)
    entrada = EntradaDocumento("texto.pdf", "pdf", fixture_bytes("text.pdf"))
    assert info_basica(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas


def test_info_xlsx_no_iterar_filas(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from openpyxl.worksheet._read_only import ReadOnlyWorksheet

    from convertitodo_mcp.read.respaldo import info_basica

    def prohibido(*args: object, **kwargs: object) -> None:
        raise AssertionError("No debe recorrer filas")

    monkeypatch.setattr(ReadOnlyWorksheet, "iter_rows", prohibido)
    entrada = EntradaDocumento("hojas.xlsx", "xlsx", fixture_bytes("multisheet.xlsx"))
    assert len(info_basica(entrada, Configuracion(carpeta_trabajo=tmp_path)).hojas) > 1


def test_info_pptx_cuenta_diapositivas(tmp_path: Path) -> None:
    from io import BytesIO
    from zipfile import ZipFile

    from convertitodo_mcp.read.respaldo import info_basica

    datos = BytesIO()
    with ZipFile(datos, "w") as paquete:
        paquete.writestr(
            "ppt/presentation.xml",
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            '<p:sldIdLst><p:sldId id="1"/><p:sldId id="2"/></p:sldIdLst></p:presentation>',
        )
    entrada = EntradaDocumento("diapositivas.pptx", "pptx", datos.getvalue())
    assert info_basica(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas == 2
    with pytest.raises(ErrorLimiteExcedido):
        info_basica(entrada, Configuracion(carpeta_trabajo=tmp_path, max_bloques=1))


def test_pdf_escaneado_sugiere_ocr_local(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path
) -> None:
    from convertitodo_mcp.errores import ErrorArgumento
    from convertitodo_mcp.read.respaldo import info_basica

    entrada = EntradaDocumento("escaneado.pdf", "pdf", fixture_bytes("scanned.pdf"))
    config = Configuracion(carpeta_trabajo=tmp_path)
    assert info_basica(entrada, config).paginas
    with pytest.raises(ErrorArgumento, match="OCR local"):
        leer_respaldo(entrada, config)


@pytest.mark.parametrize(
    ("nombre", "mensaje"),
    [("protected.pdf", "desbloqueada"), ("corrupt.pdf", "exportalo de nuevo")],
)
def test_pdf_invalido_tiene_error_seguro(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, nombre: str, mensaje: str
) -> None:
    from convertitodo_mcp.errores import ErrorArgumento
    from convertitodo_mcp.read.respaldo import info_basica

    entrada = EntradaDocumento(nombre, "pdf", fixture_bytes(nombre))
    config = Configuracion(carpeta_trabajo=tmp_path)
    with pytest.raises(ErrorArgumento, match=mensaje):
        leer_respaldo(entrada, config)
    with pytest.raises(ErrorArgumento, match=mensaje):
        info_basica(entrada, config)


def test_pdf_con_paginas_vacias_y_texto_no_se_considera_escaneado() -> None:
    from convertitodo_mcp.read.respaldo import verificar_texto_pdf

    verificar_texto_pdf(["", "contenido", "  "])
