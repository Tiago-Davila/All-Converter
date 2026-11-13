"""Validación del esquema de planilla."""

import pytest
from pydantic import ValidationError

from convertitodo_mcp.blocks.planilla import Columna, Hoja, Planilla


def _hoja(nombre: str = "Ventas", **extra: object) -> dict[str, object]:
    return {
        "nombre": nombre,
        "columnas": [{"nombre": "Producto"}, {"nombre": "Precio", "tipo": "moneda"}],
        "filas": [["Café", 1200.5], ["Té", None]],
        **extra,
    }


def test_planilla_valida_con_valores_por_defecto() -> None:
    planilla = Planilla.model_validate({"hojas": [_hoja(), _hoja("Resumen", filas=[])]})
    assert len(planilla.hojas[0].filas) == 2
    columna = planilla.hojas[0].columnas[0]
    assert (columna.tipo, columna.formato, columna.ancho) == ("texto", None, None)
    assert planilla.hojas[0].filas[1] == ["Té", None]


@pytest.mark.parametrize(
    "nombre", ["", "a" * 32, "Hoja/1", "Hoja[1]", "'Hoja", "Hoja'", "history", "Ho\x01ja"]
)
def test_rechaza_nombres_de_hoja_invalidos(nombre: str) -> None:
    with pytest.raises(ValidationError):
        Hoja.model_validate(_hoja(nombre))


def test_rechaza_hojas_repetidas_sin_distinguir_mayusculas() -> None:
    with pytest.raises(ValidationError, match="mismo nombre"):
        Planilla.model_validate({"hojas": [_hoja("Datos"), _hoja("DATOS")]})


def test_rechaza_filas_con_otra_cantidad_de_columnas() -> None:
    with pytest.raises(ValidationError, match="fila 2"):
        Hoja.model_validate(_hoja(filas=[["a", 1], ["b"]]))


def test_rechaza_columnas_repetidas_y_campos_extra() -> None:
    with pytest.raises(ValidationError, match="repetidos"):
        Hoja.model_validate(
            {"nombre": "H", "columnas": [{"nombre": "A"}, {"nombre": " a "}], "filas": []}
        )
    with pytest.raises(ValidationError):
        Columna.model_validate({"nombre": "A", "color": "rojo"})
    with pytest.raises(ValidationError):
        Planilla.model_validate({"hojas": []})


@pytest.mark.parametrize(
    "columna",
    [
        {"nombre": "A", "tipo": "booleano"},
        {"nombre": "A", "ancho": 0},
        {"nombre": "A", "ancho": 300},
        {"nombre": "A", "formato": "0\n0"},
        {"nombre": ""},
    ],
)
def test_rechaza_columnas_invalidas(columna: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Columna.model_validate(columna)
