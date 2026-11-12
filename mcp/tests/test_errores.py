"""Pruebas de los errores en español y su conversión a errores de herramienta."""

from __future__ import annotations

import inspect

import pytest
from fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field, ValidationError

from convertitodo_mcp.errores import (
    ErrorArchivoNoEncontrado,
    ErrorArgumento,
    ErrorConfiguracion,
    ErrorConvertiTodo,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
    ErrorNoAutorizado,
    ErrorRutaInsegura,
    ErrorTiempoAgotado,
    a_error_de_herramienta,
    herramienta_segura,
)


class Bloque(BaseModel):
    nivel: int = Field(ge=1, le=6)
    tipo: str


class Documento(BaseModel):
    titulo: str
    bloques: list[Bloque]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Genera una ValidationError real con varios tipos de problema.
def _error_de_validacion() -> ValidationError:
    with pytest.raises(ValidationError) as info:
        Documento.model_validate({"bloques": [{"nivel": 9, "tipo": "p"}, {"nivel": "x"}]})
    return info.value


# El mensaje une qué falló y cómo corregirlo, y str() coincide.
def test_formato_del_mensaje() -> None:
    error = ErrorConvertiTodo("Falló algo.", "Probá otra cosa.")
    assert error.que_fallo == "Falló algo."
    assert error.como_corregir == "Probá otra cosa."
    assert error.mensaje_para_modelo() == "Falló algo. Cómo corregirlo: Probá otra cosa."
    assert str(error) == error.mensaje_para_modelo()


# Cada subclase expone su código.
def test_codigos_de_las_subclases() -> None:
    esperados = {
        ErrorConvertiTodo: "error",
        ErrorArgumento: "argumento_invalido",
        ErrorArchivoNoEncontrado: "archivo_no_encontrado",
        ErrorRutaInsegura: "ruta_insegura",
        ErrorLimiteExcedido: "limite_excedido",
        ErrorTiempoAgotado: "tiempo_agotado",
        ErrorFormatoNoSoportado: "formato_no_soportado",
        ErrorConfiguracion: "configuracion_invalida",
        ErrorNoAutorizado: "no_autorizado",
    }
    for clase, codigo in esperados.items():
        assert clase.codigo == codigo
        assert issubclass(clase, ErrorConvertiTodo)


# Un ErrorConvertiTodo pasa a ToolError con su mensaje.
def test_conversion_de_error_propio() -> None:
    resultado = a_error_de_herramienta(ErrorArgumento("Mal.", "Arreglalo."))
    assert isinstance(resultado, ToolError)
    assert str(resultado) == "Mal. Cómo corregirlo: Arreglalo."


# Una ValidationError se explica en español nombrando cada campo.
def test_conversion_de_validation_error() -> None:
    mensaje = str(a_error_de_herramienta(_error_de_validacion()))
    assert "bloques.0.nivel" in mensaje
    assert "bloques.1.tipo" in mensaje
    assert "falta este campo obligatorio" in mensaje
    assert "titulo" in mensaje
    assert "fuera de rango" in mensaje
    assert "Cómo corregirlo" in mensaje
    assert "pydantic" not in mensaje.lower()
    assert "https://" not in mensaje


# Un ToolError se devuelve tal cual.
def test_toolerror_se_devuelve_igual() -> None:
    original = ToolError("ya listo")
    assert a_error_de_herramienta(original) is original


# Una excepción desconocida da un mensaje genérico sin filtrar su texto.
def test_excepcion_generica_no_filtra() -> None:
    mensaje = str(a_error_de_herramienta(RuntimeError("secreto /home/usuario/clave.txt")))
    assert mensaje.startswith("Error interno al ejecutar la herramienta")
    assert "secreto" not in mensaje
    assert "/home" not in mensaje
    assert "Traceback" not in mensaje


# El decorador sync convierte excepciones y conserva nombre y firma.
def test_decorador_sync() -> None:
    @herramienta_segura
    def sumar(a: int, b: int = 2) -> int:
        if a < 0:
            raise ErrorArgumento("Negativo.", "Usá un número positivo.")
        if a == 0:
            raise ValueError("detalle interno")
        return a + b

    assert sumar(1) == 3
    assert sumar.__name__ == "sumar"
    assert list(inspect.signature(sumar).parameters) == ["a", "b"]
    assert inspect.signature(sumar).parameters["b"].default == 2
    assert sumar.__annotations__ == {"a": "int", "b": "int", "return": "int"}
    with pytest.raises(ToolError, match="Usá un número positivo") as info:
        sumar(-1)
    assert info.value.__cause__ is None
    assert info.value.__suppress_context__
    with pytest.raises(ToolError) as info2:
        sumar(0)
    assert "detalle interno" not in str(info2.value)


# El decorador async convierte excepciones y conserva nombre y firma.
@pytest.mark.anyio
async def test_decorador_async() -> None:
    @herramienta_segura
    async def doblar(x: int) -> int:
        if x < 0:
            raise ErrorLimiteExcedido("Muy grande.", "Reducí el tamaño.")
        return x * 2

    assert inspect.iscoroutinefunction(doblar)
    assert doblar.__name__ == "doblar"
    assert list(inspect.signature(doblar).parameters) == ["x"]
    assert doblar.__annotations__ == {"x": "int", "return": "int"}
    assert await doblar(2) == 4
    with pytest.raises(ToolError, match="Reducí el tamaño"):
        await doblar(-1)
