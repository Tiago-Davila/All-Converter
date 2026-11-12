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
