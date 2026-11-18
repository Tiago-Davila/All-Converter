"""Pruebas de la configuración por variables de entorno."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from convertitodo_mcp.errores import ErrorConfiguracion
from convertitodo_mcp.server.config import PREFIJO, Configuracion, cargar_configuracion

TOKEN_VALIDO = "token-secreto-de-prueba-123456"  # noqa: S105


# Valores por defecto con entorno vacío.
def test_valores_por_defecto(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    config = cargar_configuracion({})
    assert config.transporte == "stdio"
    assert config.host == "127.0.0.1"
    assert config.puerto == 8765
    assert config.token is None
    assert config.carpeta_trabajo == tmp_path / ".local/share/convertitodo-mcp"
    assert config.ttl_minutos == 60
    assert config.max_mb == 25
    assert config.timeout_s == 60
    assert config.max_bloques == 2000
    assert config.max_filas == 10000


# Cada variable se lee correctamente.
def test_lee_cada_variable(tmp_path: Path) -> None:
    config = cargar_configuracion(
        {
            f"{PREFIJO}TRANSPORTE": "http",
            f"{PREFIJO}HOST": "0.0.0.0",  # noqa: S104
            f"{PREFIJO}PORT": "9000",
            f"{PREFIJO}TOKEN": TOKEN_VALIDO,
            f"{PREFIJO}WORKDIR": str(tmp_path),
            f"{PREFIJO}TTL_MINUTOS": "5",
            f"{PREFIJO}MAX_MB": "10",
            f"{PREFIJO}TIMEOUT_S": "30",
            f"{PREFIJO}MAX_BLOQUES": "100",
            f"{PREFIJO}MAX_FILAS": "200",
            "OTRA_VARIABLE": "ignorada",
        }
    )
    assert config.transporte == "http"
    assert config.host == "0.0.0.0"  # noqa: S104
    assert config.puerto == 9000
    assert config.token is not None
    assert config.token.get_secret_value() == TOKEN_VALIDO
    assert config.carpeta_trabajo == tmp_path
    assert config.ttl_minutos == 5
    assert config.max_mb == 10
    assert config.timeout_s == 30
    assert config.max_bloques == 100
    assert config.max_filas == 200


# Se respeta XDG_DATA_HOME para la carpeta por defecto.
def test_respeta_xdg_data_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "datos"))
    config = cargar_configuracion({})
    assert config.carpeta_trabajo == tmp_path / "datos" / "convertitodo-mcp"


# La carpeta de trabajo expande ~ y queda absoluta.
def test_expande_tilde(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    config = cargar_configuracion({f"{PREFIJO}WORKDIR": "~/trabajo"})
    assert config.carpeta_trabajo == tmp_path / "trabajo"
    assert config.carpeta_trabajo.is_absolute()
    assert not config.carpeta_trabajo.exists()


# La carpeta relativa se vuelve absoluta.
def test_carpeta_relativa_queda_absoluta() -> None:
    config = cargar_configuracion({f"{PREFIJO}WORKDIR": "relativa/x"})
    assert config.carpeta_trabajo.is_absolute()


# Cada valor inválido lanza ErrorConfiguracion nombrando la variable.
@pytest.mark.parametrize(
    ("variable", "valor"),
    [
        ("PORT", "0"),
        ("PORT", "70000"),
        ("PORT", "abc"),
        ("TTL_MINUTOS", "0"),
        ("MAX_MB", "0"),
        ("TIMEOUT_S", "-1"),
        ("MAX_BLOQUES", "0"),
        ("MAX_FILAS", "x"),
        ("TRANSPORTE", "websocket"),
        ("HOST", "   "),
        ("TOKEN", "corto"),
    ],
)
def test_valores_invalidos(variable: str, valor: str) -> None:
    nombre = PREFIJO + variable
    with pytest.raises(ErrorConfiguracion) as info:
        cargar_configuracion({nombre: valor})
    assert nombre in str(info.value)
    assert f"{nombre}=" in info.value.como_corregir


# Una variable desconocida con el prefijo es error y lista las válidas.
def test_variable_desconocida() -> None:
    with pytest.raises(ErrorConfiguracion) as info:
        cargar_configuracion({f"{PREFIJO}PUERTO": "80"})
    mensaje = str(info.value)
    assert f"{PREFIJO}PUERTO" in mensaje
    assert f"{PREFIJO}PORT" in mensaje


# Un token vacío o con espacios equivale a no definirlo.
def test_token_vacio_es_none() -> None:
    assert cargar_configuracion({f"{PREFIJO}TOKEN": ""}).token is None
    assert cargar_configuracion({f"{PREFIJO}TOKEN": "   "}).token is None


# El token no aparece en repr, str, model_dump ni en el error de longitud.
def test_token_no_se_filtra() -> None:
    config = cargar_configuracion({f"{PREFIJO}TOKEN": TOKEN_VALIDO})
    assert TOKEN_VALIDO not in repr(config)
    assert TOKEN_VALIDO not in str(config)
    assert TOKEN_VALIDO not in str(config.model_dump())
    with pytest.raises(ErrorConfiguracion) as info:
        cargar_configuracion({f"{PREFIJO}TOKEN": "secreto-corto"})
    assert "secreto-corto" not in str(info.value)


# max_bytes convierte los megabytes a bytes.
def test_max_bytes() -> None:
    assert cargar_configuracion({f"{PREFIJO}MAX_MB": "2"}).max_bytes == 2 * 1024 * 1024


# La configuración es inmutable.
def test_es_inmutable() -> None:
    config = cargar_configuracion({})
    with pytest.raises(ValidationError):
        config.puerto = 1
    assert isinstance(config, Configuracion)
