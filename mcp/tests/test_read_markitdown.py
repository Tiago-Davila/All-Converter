"""Pruebas del adaptador local de MarkItDown."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from pptx import Presentation

from convertitodo_mcp.errores import ErrorLimiteExcedido
from convertitodo_mcp.read.markitdown import leer_markitdown
from convertitodo_mcp.read.modelos import EntradaDocumento, TipoDocumento
from convertitodo_mcp.server.config import Configuracion


@pytest.mark.parametrize(
    ("nombre", "tipo"),
    [("text.pdf", "pdf"), ("sample.docx", "docx"), ("sample.csv", "csv")],
)
def test_lee_fixtures(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, nombre: str, tipo: TipoDocumento
) -> None:
    entrada = EntradaDocumento(nombre, tipo, fixture_bytes(nombre))
    resultado = leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path))
    assert any(pagina.strip() for pagina in resultado.paginas)


def test_xlsx_conserva_hojas(fixture_bytes: Callable[[str], bytes], tmp_path: Path) -> None:
    entrada = EntradaDocumento("multisheet.xlsx", "xlsx", fixture_bytes("multisheet.xlsx"))
    resultado = leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path))
    assert len(resultado.hojas) > 1
    assert len(resultado.paginas) == len(resultado.hojas)


def test_html(tmp_path: Path) -> None:
    entrada = EntradaDocumento("a.html", "html", b"<html><body><h1>Hola</h1></body></html>")
    assert "Hola" in leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas[0]


def test_pptx_conserva_diapositivas(tmp_path: Path) -> None:
    presentacion = Presentation()
    for texto in ("Primera", "Segunda"):
        slide = presentacion.slides.add_slide(presentacion.slide_layouts[0])
        slide.shapes.title.text = texto
    archivo = BytesIO()
    presentacion.save(archivo)
    entrada = EntradaDocumento("a.pptx", "pptx", archivo.getvalue())
    paginas = leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas
    assert len(paginas) == 2
    assert "Primera" in paginas[0] and "Segunda" in paginas[1]


def test_respaldo_si_falla_conversor(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fallar(*args: object) -> str:
        raise ValueError("fallo")

    monkeypatch.setattr("convertitodo_mcp.read.markitdown._convertir", fallar)
    entrada = EntradaDocumento("sample.docx", "docx", fixture_bytes("sample.docx"))
    assert leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas


def test_limite_no_activa_respaldo(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fallar(*args: object) -> str:
        raise ErrorLimiteExcedido("Límite", "reducí el archivo")

    monkeypatch.setattr("convertitodo_mcp.read.markitdown._convertir", fallar)
    entrada = EntradaDocumento("sample.docx", "docx", fixture_bytes("sample.docx"))
    with pytest.raises(ErrorLimiteExcedido):
        leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path))


def test_csv_limita_filas_antes_del_conversor(tmp_path: Path) -> None:
    entrada = EntradaDocumento("a.csv", "csv", b"a,b\n1,2\n3,4\n")
    with pytest.raises(ErrorLimiteExcedido):
        leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path, max_filas=2))


def test_docx_limita_bloques_antes_del_conversor(
    fixture_bytes: Callable[[str], bytes], tmp_path: Path
) -> None:
    entrada = EntradaDocumento("sample.docx", "docx", fixture_bytes("sample.docx"))
    with pytest.raises(ErrorLimiteExcedido):
        leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path, max_bloques=0))


@pytest.mark.parametrize("tipo", ["html", "docx"])
def test_lectura_sin_red(
    tipo: str,
    fixture_bytes: Callable[[str], bytes],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    intentos: list[bool] = []

    def prohibir_red(*args: object, **kwargs: object) -> None:
        intentos.append(True)
        raise AssertionError("La lectura intentó acceder a la red")

    monkeypatch.setattr("requests.sessions.Session.request", prohibir_red)
    if tipo == "html":
        entrada = EntradaDocumento("a.html", "html", b"<html><body>Hola</body></html>")
    else:
        entrada = EntradaDocumento("sample.docx", "docx", fixture_bytes("sample.docx"))
    assert leer_markitdown(entrada, Configuracion(carpeta_trabajo=tmp_path)).paginas
    assert not intentos
