"""Tests del modelo de bloques."""

import pytest
from pydantic import ValidationError

from convertitodo_mcp.blocks import (
    Cita,
    Codigo,
    Documento,
    Imagen,
    Lista,
    Parrafo,
    SaltoPagina,
    Tabla,
    Titulo,
    Tramo,
    texto_plano,
)


# Construye un documento de un solo bloque a partir de un dict.
def _doc(bloque: dict[str, object]) -> Documento:
    return Documento.model_validate({"bloques": [bloque]})


# Construye una lista anidada con la cantidad de niveles indicada.
def _lista_anidada(niveles: int) -> dict[str, object]:
    lista: dict[str, object] = {"tipo": "lista", "items": ["hoja"]}
    for _ in range(niveles - 1):
        lista = {"tipo": "lista", "items": [{"texto": "x", "sublista": lista}]}
    return lista


# Cada tipo de bloque se construye desde un dict JSON.
def test_cada_tipo_de_bloque_desde_dict() -> None:
    doc = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "titulo", "nivel": 2, "texto": "Hola"},
                {"tipo": "parrafo", "texto": [{"texto": "a", "negrita": True}, "b"]},
                {"tipo": "lista", "ordenada": True, "items": ["uno", "dos"]},
                {"tipo": "tabla", "encabezado": ["A", "B"], "filas": [["1", "2"]]},
                {"tipo": "imagen", "archivo": "abc123", "ancho_mm": 50, "texto_alternativo": "x"},
                {"tipo": "codigo", "texto": "print(1)", "lenguaje": "python"},
                {"tipo": "cita", "texto": "Dicho"},
                {"tipo": "salto_pagina"},
            ]
        }
    )
    tipos = [type(b) for b in doc.bloques]
    assert tipos == [Titulo, Parrafo, Lista, Tabla, Imagen, Codigo, Cita, SaltoPagina]
    assert doc.bloques[0].nivel == 2  # type: ignore[union-attr]


# Un str suelto se convierte en un único tramo en párrafo, item y celda.
def test_coercion_de_str_a_tramos() -> None:
    parrafo = _doc({"tipo": "parrafo", "texto": "Hola"}).bloques[0]
    assert isinstance(parrafo, Parrafo)
    assert parrafo.texto == [Tramo(texto="Hola")]

    lista = _doc({"tipo": "lista", "items": ["uno"]}).bloques[0]
    assert isinstance(lista, Lista)
    assert lista.items[0].texto == [Tramo(texto="uno")]

    tabla = _doc({"tipo": "tabla", "encabezado": ["H"], "filas": [["c"]]}).bloques[0]
    assert isinstance(tabla, Tabla)
    assert tabla.filas[0][0] == [Tramo(texto="c")]
    assert tabla.encabezado == [[Tramo(texto="H")]]


# Una lista mezcla str y objetos como tramos.
def test_lista_de_tramos_mixta() -> None:
    parrafo = _doc({"tipo": "parrafo", "texto": ["a ", {"texto": "b", "italica": True}]}).bloques[0]
    assert isinstance(parrafo, Parrafo)
    assert [t.italica for t in parrafo.texto] == [False, True]


# Las listas anidadas se aceptan hasta el tope de profundidad.
def test_lista_anidada_y_tope() -> None:
    doc = _doc(_lista_anidada(6))
    lista = doc.bloques[0]
    assert isinstance(lista, Lista)
    assert lista.profundidad() == 6
    with pytest.raises(ValidationError, match="niveles de anidación"):
        _doc(_lista_anidada(7))


# Una tabla con filas desparejas falla y el mensaje nombra la fila.
def test_tabla_columnas_desparejas() -> None:
    with pytest.raises(ValidationError, match="La fila 2"):
        _doc({"tipo": "tabla", "encabezado": ["A", "B"], "filas": [["1", "2"], ["3"]]})
    with pytest.raises(ValidationError, match="La fila 2"):
        _doc({"tipo": "tabla", "filas": [["1", "2"], ["3"]]})


# El nivel de título fuera de rango se rechaza.
@pytest.mark.parametrize("nivel", [0, 7])
def test_nivel_de_titulo_fuera_de_rango(nivel: int) -> None:
    with pytest.raises(ValidationError):
        _doc({"tipo": "titulo", "nivel": nivel, "texto": "x"})


# Los enlaces con esquemas prohibidos se rechazan y los permitidos pasan.
def test_enlace_esquema_prohibido() -> None:
    for malo in ("javascript:alert(1)", "file:///etc/passwd", "www.ejemplo.com"):
        with pytest.raises(ValidationError, match="enlace"):
            Tramo(texto="x", enlace=malo)
    for bueno in ("http://a.com", "https://a.com/x", "mailto:a@b.com"):
        assert Tramo(texto="x", enlace=bueno).enlace == bueno


# Un campo extra se rechaza.
def test_campo_extra_rechazado() -> None:
    with pytest.raises(ValidationError):
        _doc({"tipo": "parrafo", "texto": "x", "color": "rojo"})


# Un tipo desconocido se rechaza.
def test_tipo_desconocido_rechazado() -> None:
    with pytest.raises(ValidationError):
        _doc({"tipo": "video", "texto": "x"})


# La imagen solo admite ids opacos y anchos positivos.
def test_imagen_valida_archivo_y_ancho() -> None:
    for malo in ("/etc/passwd", "data:image/png;base64,AAAA", "../x.png", ""):
        with pytest.raises(ValidationError):
            _doc({"tipo": "imagen", "archivo": malo})
    with pytest.raises(ValidationError):
        _doc({"tipo": "imagen", "archivo": "abc", "ancho_mm": 0})


# El documento sobrevive a la ida y vuelta por model_dump.
def test_ida_y_vuelta() -> None:
    doc = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "titulo", "texto": "T"},
                {"tipo": "lista", "items": [{"texto": "a", "sublista": {"items": ["b"]}}]},
                {"tipo": "tabla", "encabezado": ["A"], "filas": [["1"]]},
                {"tipo": "salto_pagina"},
            ]
        }
    )
    assert Documento.model_validate(doc.model_dump()) == doc


# El esquema JSON se genera y contiene los ocho tipos de bloque.
def test_esquema_json_contiene_los_ocho_tipos() -> None:
    esquema = str(Documento.model_json_schema())
    for tipo in (
        "titulo",
        "parrafo",
        "lista",
        "tabla",
        "imagen",
        "codigo",
        "cita",
        "salto_pagina",
    ):
        assert f"'{tipo}'" in esquema


# texto_plano concatena el texto de los tramos.
def test_texto_plano() -> None:
    tramos = [Tramo(texto="Hola ", negrita=True), Tramo(texto="mundo", enlace="https://a.com")]
    assert texto_plano(tramos) == "Hola mundo"
    assert texto_plano([]) == ""
