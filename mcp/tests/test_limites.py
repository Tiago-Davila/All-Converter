"""Tests de los límites de tamaño, bloques, filas y tiempo."""

import inspect
import time
from pathlib import Path

import pytest

from convertitodo_mcp.blocks import Bloque, Lista, Parrafo, Tabla
from convertitodo_mcp.errores import ErrorLimiteExcedido, ErrorTiempoAgotado
from convertitodo_mcp.limites import (
    con_limite_de_tiempo,
    contar_bloques,
    contar_filas,
    ejecutar_con_limite,
    verificar_bloques,
    verificar_filas,
    verificar_tamano,
    verificar_texto,
)
from convertitodo_mcp.server.config import Configuracion

MB = 1024 * 1024


# Usa asyncio como único backend de anyio.
@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Configuración con topes chicos para los tests.
@pytest.fixture
def config(tmp_path: Path) -> Configuracion:
    return Configuracion(
        carpeta_trabajo=tmp_path, max_mb=1, max_bloques=5, max_filas=3, timeout_s=1
    )


# Crea n párrafos de relleno.
def _parrafos(n: int) -> list[Bloque]:
    return [Parrafo.model_validate({"texto": "x"}) for _ in range(n)]


# Crea una tabla con n filas de una celda.
def _tabla(n: int) -> Tabla:
    return Tabla.model_validate({"filas": [["a"] for _ in range(n)]})


# Justo en el tope de bytes pasa y un byte más falla con tamaño y tope en el mensaje.
def test_verificar_tamano_en_el_tope(config: Configuracion) -> None:
    verificar_tamano(MB, config)
    with pytest.raises(ErrorLimiteExcedido) as info:
        verificar_tamano(MB + 1, config, que="el PDF")
    mensaje = str(info.value)
    assert "1.00 MB" in mensaje
    assert "1 MB" in mensaje
    assert "El PDF" in mensaje
    assert "dividilo" in mensaje


# El texto se mide en bytes UTF-8 y no en caracteres.
def test_verificar_texto_cuenta_bytes(config: Configuracion) -> None:
    verificar_texto("a" * MB, config)
    with pytest.raises(ErrorLimiteExcedido):
        verificar_texto("a" * (MB - 1) + "ñ", config)
    with pytest.raises(ErrorLimiteExcedido):
        verificar_texto("€" * (MB // 3 + 1), config)
    verificar_texto("€" * (MB // 3), config)


# Una lista anidada cuenta el contenedor, sus items y los de sus sublistas.
def test_contar_bloques_lista_anidada() -> None:
    sub = {"items": ["a", "b"]}
    lista = Lista.model_validate({"items": [{"texto": "x", "sublista": sub}, "y"]})
    assert contar_bloques([lista]) == 1 + 2 + 2
    assert contar_bloques([]) == 0


# Una tabla cuenta como un bloque más sus filas.
def test_contar_bloques_tabla() -> None:
    assert contar_bloques([_tabla(3), *_parrafos(1)]) == 4 + 1


# Solo cuentan las filas de datos de todas las tablas.
def test_contar_filas_varias_tablas() -> None:
    tabla = Tabla.model_validate({"encabezado": ["h"], "filas": [["a"], ["b"]]})
    assert contar_filas([tabla, *_parrafos(2), _tabla(3)]) == 5


# Justo en el tope de bloques pasa y uno más falla nombrando cantidad y tope.
def test_verificar_bloques_tope(config: Configuracion) -> None:
    verificar_bloques(_parrafos(5), config)
    with pytest.raises(ErrorLimiteExcedido) as info:
        verificar_bloques(_parrafos(6), config)
    assert "6 bloques" in str(info.value)
    assert "5" in str(info.value)
    assert "varios archivos" in str(info.value)


# Una tabla gigante no pasa como un solo bloque.
def test_verificar_bloques_tabla_gigante(config: Configuracion) -> None:
    with pytest.raises(ErrorLimiteExcedido):
        verificar_bloques([_tabla(3), _tabla(1)], config)


# Con bloques de sobra pero filas en el tope pasa y una fila más falla por filas.
def test_verificar_bloques_filas(tmp_path: Path) -> None:
    holgada = Configuracion(carpeta_trabajo=tmp_path, max_bloques=100, max_filas=3)
    verificar_bloques([_tabla(3)], holgada)
    with pytest.raises(ErrorLimiteExcedido) as info:
        verificar_bloques([_tabla(2), _tabla(2)], holgada)
    assert "4 filas" in str(info.value)
    assert "3" in str(info.value)


# Las filas de una planilla respetan el tope.
def test_verificar_filas(config: Configuracion) -> None:
    verificar_filas(3, config)
    with pytest.raises(ErrorLimiteExcedido) as info:
        verificar_filas(4, config, que="la hoja")
    assert "La hoja" in str(info.value)
    assert "4 filas" in str(info.value)


# Devuelve el valor cuando la función termina a tiempo.
@pytest.mark.anyio
async def test_ejecutar_con_limite_devuelve_valor() -> None:
    assert await ejecutar_con_limite(lambda: 42, 1) == 42


# Lanza ErrorTiempoAgotado cuando la función bloqueante excede el plazo.
@pytest.mark.anyio
async def test_ejecutar_con_limite_vence() -> None:
    inicio = time.monotonic()
    with pytest.raises(ErrorTiempoAgotado) as info:
        await ejecutar_con_limite(lambda: time.sleep(0.5), 0.05, que="la conversión")
    assert time.monotonic() - inicio < 0.4
    assert "0.05" in str(info.value)
    assert "CONVERTITODO_MCP_TIMEOUT_S" in str(info.value)


# Una excepción propia de la función se propaga sin convertirse en timeout.
@pytest.mark.anyio
async def test_ejecutar_con_limite_propaga_excepcion() -> None:
    def falla() -> None:
        raise KeyError("x")

    with pytest.raises(KeyError):
        await ejecutar_con_limite(falla, 1)


# Un TimeoutError propio de la función no se confunde con el vencimiento.
@pytest.mark.anyio
async def test_ejecutar_con_limite_timeout_propio() -> None:
    def falla() -> None:
        raise TimeoutError("propio")

    with pytest.raises(TimeoutError):
        await ejecutar_con_limite(falla, 1)


# El decorador devuelve el valor y conserva nombre y firma.
@pytest.mark.anyio
async def test_decorador_conserva_firma() -> None:
    @con_limite_de_tiempo(1)
    async def sumar(a: int, b: int = 2) -> int:
        return a + b

    assert await sumar(1) == 3
    assert sumar.__name__ == "sumar"
    assert list(inspect.signature(sumar).parameters) == ["a", "b"]


# El decorador lanza ErrorTiempoAgotado cuando la función async excede el plazo.
@pytest.mark.anyio
async def test_decorador_vence() -> None:
    import anyio

    @con_limite_de_tiempo(0.05, que="la lectura")
    async def lenta() -> None:
        await anyio.sleep(0.5)

    with pytest.raises(ErrorTiempoAgotado) as info:
        await lenta()
    assert "La lectura" in str(info.value)


# Una excepción propia de la función decorada se propaga tal cual.
@pytest.mark.anyio
async def test_decorador_propaga_excepcion() -> None:
    @con_limite_de_tiempo(1)
    async def falla() -> None:
        raise ValueError("propio")

    with pytest.raises(ValueError, match="propio"):
        await falla()


# Un plazo no positivo es un error de programación.
@pytest.mark.anyio
async def test_segundos_no_positivos() -> None:
    with pytest.raises(ValueError, match="mayor que 0"):
        con_limite_de_tiempo(0)
    with pytest.raises(ValueError, match="mayor que 0"):
        await ejecutar_con_limite(lambda: 1, -1)
