"""Pruebas del parser de Markdown a bloques."""

from collections.abc import Callable
from pathlib import Path

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
    markdown_a_bloques,
    markdown_a_documento,
    texto_plano,
)


# Lee el fixture sample.md como texto.
def _sample(fixture_path: Callable[[str], Path]) -> str:
    return fixture_path("sample.md").read_text(encoding="utf-8")


# Texto plano de una celda.
def _celda(tramos: list[Tramo]) -> str:
    return texto_plano(tramos)


# El fixture produce 12 bloques con los tipos esperados en orden.
def test_sample_tipos_y_cantidad(fixture_path: Callable[[str], Path]) -> None:
    bloques = markdown_a_bloques(_sample(fixture_path))
    assert [b.tipo for b in bloques] == [
        "titulo",
        "parrafo",
        "titulo",
        "lista",
        "titulo",
        "lista",
        "titulo",
        "tabla",
        "cita",
        "parrafo",
        "codigo",
        "parrafo",
    ]


# Los títulos del fixture conservan texto y nivel.
def test_sample_titulos(fixture_path: Callable[[str], Path]) -> None:
    titulos = [b for b in markdown_a_bloques(_sample(fixture_path)) if isinstance(b, Titulo)]
    assert [(t.nivel, texto_plano(t.texto)) for t in titulos] == [
        (1, "Informe de ventas"),
        (2, "Productos destacados"),
        (3, "Pasos del proceso"),
        (2, "Detalle"),
    ]


# El primer párrafo del fixture combina negrita, itálica y ambas.
def test_sample_enfasis(fixture_path: Callable[[str], Path]) -> None:
    parrafo = markdown_a_bloques(_sample(fixture_path))[1]
    assert isinstance(parrafo, Parrafo)
    assert [(t.texto, t.negrita, t.italica) for t in parrafo.texto if t.negrita or t.italica] == [
        ("negrita", True, False),
        ("itálica", False, True),
        ("las dos a la vez", True, True),
    ]
    assert "\n" not in texto_plano(parrafo.texto)


# Las listas del fixture respetan orden y anidación.
def test_sample_listas(fixture_path: Callable[[str], Path]) -> None:
    bloques = markdown_a_bloques(_sample(fixture_path))
    viñetas, numerada = bloques[3], bloques[5]
    assert isinstance(viñetas, Lista)
    assert not viñetas.ordenada
    assert [texto_plano(i.texto) for i in viñetas.items] == [
        "Café de especialidad",
        "Té de hebras",
        "Chocolate amargo",
    ]
    sublista = viñetas.items[1].sublista
    assert sublista is not None
    assert [texto_plano(i.texto) for i in sublista.items] == ["Verde", "Rojo"]
    assert isinstance(numerada, Lista)
    assert numerada.ordenada
    assert [texto_plano(i.texto) for i in numerada.items] == [
        "Recibir el pedido",
        "Preparar el envío",
        "Confirmar la entrega",
    ]


# La tabla del fixture sale con encabezados y celdas.
def test_sample_tabla(fixture_path: Callable[[str], Path]) -> None:
    tabla = markdown_a_bloques(_sample(fixture_path))[7]
    assert isinstance(tabla, Tabla)
    assert tabla.encabezado is not None
    assert [_celda(c) for c in tabla.encabezado] == ["Producto", "Unidades", "Precio"]
    assert [[_celda(c) for c in fila] for fila in tabla.filas] == [
        ["Café", "120", "100"],
        ["Té", "80", "85"],
        ["Chocolate", "45", "130"],
    ]


# La cita, el enlace, el código y el código en línea del fixture se conservan.
def test_sample_cita_enlace_codigo(fixture_path: Callable[[str], Path]) -> None:
    bloques = markdown_a_bloques(_sample(fixture_path))
    cita, enlace, codigo, cierre = bloques[8], bloques[9], bloques[10], bloques[11]
    assert isinstance(cita, Cita)
    assert texto_plano(cita.texto) == "El margen del trimestre superó lo previsto."
    assert isinstance(enlace, Parrafo)
    assert [(t.texto, t.enlace) for t in enlace.texto if t.enlace] == [
        ("la guía interna", "https://ejemplo.local/guia")
    ]
    assert isinstance(codigo, Codigo)
    assert codigo.lenguaje == "ts"
    assert codigo.texto == "const total = unidades * precio"
    assert isinstance(cierre, Parrafo)
    assert [t.texto for t in cierre.texto if t.codigo] == ["npm run ci"]


# El documento del fixture hace ida y vuelta por el modelo.
def test_documento_ida_y_vuelta(fixture_path: Callable[[str], Path]) -> None:
    doc = markdown_a_documento(_sample(fixture_path))
    assert len(doc.bloques) == 12
    assert Documento.model_validate(doc.model_dump()) == doc


# Un título de cada nivel se mapea con su nivel.
def test_titulos_seis_niveles() -> None:
    texto = "\n\n".join(f"{'#' * n} T{n}" for n in range(1, 7))
    bloques = markdown_a_bloques(texto)
    assert [(b.nivel, texto_plano(b.texto)) for b in bloques if isinstance(b, Titulo)] == [
        (n, f"T{n}") for n in range(1, 7)
    ]


# Negrita e itálica anidadas se combinan en el mismo tramo.
def test_negrita_italica_combinadas() -> None:
    (parrafo,) = markdown_a_bloques("**a *b* c**")
    assert isinstance(parrafo, Parrafo)
    assert [(t.texto, t.negrita, t.italica) for t in parrafo.texto] == [
        ("a ", True, False),
        ("b", True, True),
        (" c", True, False),
    ]


# Un enlace con esquema no permitido pierde el enlace pero conserva el texto.
def test_enlace_javascript_pierde_enlace() -> None:
    (parrafo,) = markdown_a_bloques("Ver [aquí](javascript:alert(1)) o [web](https://a.b).")
    assert isinstance(parrafo, Parrafo)
    assert texto_plano(parrafo.texto) == "Ver aquí o web."
    assert [(t.texto, t.enlace) for t in parrafo.texto if t.enlace] == [("web", "https://a.b")]


# Los saltos suaves son espacios y los duros son saltos de línea.
def test_saltos_suaves_y_duros() -> None:
    (parrafo,) = markdown_a_bloques("uno\ndos  \ntres")
    assert isinstance(parrafo, Parrafo)
    assert texto_plano(parrafo.texto) == "uno dos\ntres"


# Una lista anidada de tres niveles mezcla ordenadas y con viñetas.
def test_lista_anidada_tres_niveles() -> None:
    (lista,) = markdown_a_bloques("- a\n  1. b\n     - c\n- d")
    assert isinstance(lista, Lista)
    assert not lista.ordenada
    nivel2 = lista.items[0].sublista
    assert nivel2 is not None
    assert nivel2.ordenada
    nivel3 = nivel2.items[0].sublista
    assert nivel3 is not None
    assert not nivel3.ordenada
    assert texto_plano(nivel3.items[0].texto) == "c"
    assert texto_plano(lista.items[1].texto) == "d"


# Lo que excede la profundidad máxima se aplana en el último nivel permitido.
def test_lista_profunda_se_aplana() -> None:
    texto = "\n".join(f"{'  ' * n}- n{n + 1}" for n in range(8))
    (lista,) = markdown_a_bloques(texto)
    assert isinstance(lista, Lista)
    assert lista.profundidad() == 6
    ultimo = lista
    while ultimo.items[0].sublista is not None:
        ultimo = ultimo.items[0].sublista
    assert [texto_plano(i.texto) for i in ultimo.items] == ["n6", "n7", "n8"]


# Un item con varios párrafos los une en un solo texto.
def test_item_varios_parrafos() -> None:
    (lista,) = markdown_a_bloques("- p1\n\n  p2")
    assert isinstance(lista, Lista)
    assert texto_plano(lista.items[0].texto) == "p1\np2"


# El énfasis dentro de una celda de tabla se conserva.
def test_tabla_con_enfasis_en_celda() -> None:
    (tabla,) = markdown_a_bloques("| a | b |\n| --- | --- |\n| **x** | *y* |")
    assert isinstance(tabla, Tabla)
    assert tabla.filas[0][0][0].negrita
    assert tabla.filas[0][1][0].italica


# Una tabla con filas desparejas se normaliza sin lanzar.
def test_tabla_filas_desparejas() -> None:
    (tabla,) = markdown_a_bloques("| a | b |\n|---|---|\n| z |\n| 1 | 2 | 3 |")
    assert isinstance(tabla, Tabla)
    assert all(len(f) == 2 for f in tabla.filas)
    assert texto_plano(tabla.filas[0][0]) == "z"
    assert tabla.filas[0][1] == []
    assert texto_plano(tabla.filas[1][1]) == "2"


# El código con cerca guarda el lenguaje y el texto literal sin la última línea vacía.
def test_codigo_con_lenguaje() -> None:
    (codigo,) = markdown_a_bloques("```python\nif x:\n    print(1)\n\n```")
    assert isinstance(codigo, Codigo)
    assert codigo.lenguaje == "python"
    assert codigo.texto == "if x:\n    print(1)\n"


# El código indentado se convierte en un bloque de código sin lenguaje.
def test_codigo_indentado() -> None:
    (codigo,) = markdown_a_bloques("    uno\n    dos")
    assert isinstance(codigo, Codigo)
    assert codigo.lenguaje is None
    assert codigo.texto == "uno\ndos"


# Una cita de varios párrafos los une con salto de línea.
def test_cita_multiparrafo() -> None:
    (cita,) = markdown_a_bloques("> uno\n>\n> dos")
    assert isinstance(cita, Cita)
    assert texto_plano(cita.texto) == "uno\ndos"


# Una cita con una lista adentro conserva el texto plano.
def test_cita_con_lista() -> None:
    (cita,) = markdown_a_bloques("> - a\n> - b")
    assert isinstance(cita, Cita)
    assert texto_plano(cita.texto) == "a\nb"


# Las líneas horizontales se convierten en saltos de página.
def test_regla_horizontal_es_salto() -> None:
    bloques = markdown_a_bloques("uno\n\n---\n\n***\n\ndos")
    assert [b.tipo for b in bloques] == ["parrafo", "salto_pagina", "salto_pagina", "parrafo"]
    assert isinstance(bloques[1], SaltoPagina)


# Una imagen sola con un id válido genera un bloque Imagen.
def test_imagen_con_id_valido() -> None:
    (imagen,) = markdown_a_bloques("![logo de la empresa](abc123)")
    assert isinstance(imagen, Imagen)
    assert imagen.archivo == "abc123"
    assert imagen.texto_alternativo == "logo de la empresa"


# Una imagen con URL externa queda como texto alternativo, sin descargar nada.
def test_imagen_url_externa_queda_como_texto() -> None:
    (parrafo,) = markdown_a_bloques("![gráfico](https://ejemplo.com/a.png)")
    assert isinstance(parrafo, Parrafo)
    assert texto_plano(parrafo.texto) == "gráfico"
    assert all(t.enlace is None for t in parrafo.texto)


# Una imagen con data URI o dentro de un párrafo queda como texto.
def test_imagen_data_uri_o_en_linea() -> None:
    (a,) = markdown_a_bloques("![uno](data:image/png;base64,AAAA)")
    (b,) = markdown_a_bloques("texto ![dos](abc123) más")
    assert isinstance(a, Parrafo)
    assert texto_plano(a.texto) == "uno"
    assert isinstance(b, Parrafo)
    assert texto_plano(b.texto) == "texto dos más"


# El HTML crudo se trata como texto literal.
def test_html_crudo_literal() -> None:
    bloques = markdown_a_bloques("<b>hola</b>\n\n<div>x</div>")
    assert [b.tipo for b in bloques] == ["parrafo", "parrafo"]
    assert isinstance(bloques[0], Parrafo)
    assert texto_plano(bloques[0].texto) == "<b>hola</b>"


# Markdown roto no lanza y se degrada a párrafos.
def test_markdown_roto_no_lanza() -> None:
    bloques = markdown_a_bloques("**sin cerrar y *raro\n\n| a |\n| x\n\n[enlace](\n\n```sin cierre")
    assert bloques
    assert markdown_a_documento("**sin cerrar y *raro").bloques[0].tipo == "parrafo"


# El texto vacío o solo espacios produce una lista vacía.
def test_texto_vacio() -> None:
    assert markdown_a_bloques("") == []
    assert markdown_a_bloques("  \n\n \t") == []
