"""Fixtures compartidos que reutilizan los archivos de prueba de la app web."""

from collections.abc import Callable
from pathlib import Path

import pytest

# mcp/tests/conftest.py -> raíz del repo es parents[2]
FIXTURES_DIR: Path = Path(__file__).resolve().parents[2] / "all-converter" / "tests" / "fixtures"


# Devuelve la carpeta de fixtures o falla con un mensaje claro si no existe.
@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    if not FIXTURES_DIR.is_dir():
        pytest.fail(
            f"No existe la carpeta de fixtures de la app web: {FIXTURES_DIR}",
            pytrace=False,
        )
    return FIXTURES_DIR


# Devuelve una función que resuelve un fixture por nombre dentro de la carpeta.
@pytest.fixture
def fixture_path(fixtures_dir: Path) -> Callable[[str], Path]:
    base = fixtures_dir.resolve()

    # Resuelve el nombre y rechaza rutas que escapen de la carpeta.
    def _resolver(nombre: str) -> Path:
        candidata = (base / nombre).resolve()
        if not candidata.is_relative_to(base) or candidata == base:
            pytest.fail(
                f"Nombre de fixture inválido (fuera de la carpeta): {nombre!r}",
                pytrace=False,
            )
        if not candidata.is_file():
            disponibles = ", ".join(sorted(p.name for p in base.iterdir() if p.is_file()))
            pytest.fail(
                f"No existe el fixture {nombre!r}. Disponibles: {disponibles}",
                pytrace=False,
            )
        return candidata

    return _resolver


# Devuelve una función que lee el contenido binario de un fixture.
@pytest.fixture
def fixture_bytes(fixture_path: Callable[[str], Path]) -> Callable[[str], bytes]:
    # Lee los bytes del fixture pedido.
    def _leer(nombre: str) -> bytes:
        return fixture_path(nombre).read_bytes()

    return _leer
