"""Pruebas de humo de los fixtures compartidos con la app web."""

from collections.abc import Callable
from pathlib import Path

import pytest

ARCHIVOS = [
    "sample.md",
    "sample.docx",
    "sample.xlsx",
    "sample.csv",
    "sample.json",
    "sample.png",
    "text.pdf",
    "scanned.pdf",
    "protected.pdf",
    "corrupt.pdf",
]


# La carpeta existe y contiene archivos.
def test_carpeta_existe_y_no_esta_vacia(fixtures_dir: Path) -> None:
    assert fixtures_dir.is_dir()
    assert any(fixtures_dir.iterdir())


# Cada archivo usado por las fases siguientes existe y no está vacío.
@pytest.mark.parametrize("nombre", ARCHIVOS)
def test_fixture_existe(fixture_path: Callable[[str], Path], nombre: str) -> None:
    ruta = fixture_path(nombre)
    assert ruta.is_file()
    assert ruta.stat().st_size > 0


# El PDF de texto empieza con la firma %PDF.
def test_text_pdf_empieza_con_firma(fixture_bytes: Callable[[str], bytes]) -> None:
    assert fixture_bytes("text.pdf").startswith(b"%PDF")


# Un nombre inexistente falla con mensaje claro.
def test_nombre_inexistente_falla(fixture_path: Callable[[str], Path]) -> None:
    with pytest.raises(pytest.fail.Exception, match="No existe el fixture"):
        fixture_path("no-existe.xyz")


# Un nombre que escapa de la carpeta o es absoluto falla.
@pytest.mark.parametrize("nombre", ["../conftest.py", "../../package.json", "/etc/passwd"])
def test_nombre_fuera_de_carpeta_falla(fixture_path: Callable[[str], Path], nombre: str) -> None:
    with pytest.raises(pytest.fail.Exception, match="inválido"):
        fixture_path(nombre)
