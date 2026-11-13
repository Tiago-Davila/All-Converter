"""PDF a Markdown, bloques y Word con documentos reales."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from docx import Document

from convertitodo_mcp.blocks import Bloque, ItemLista, Lista, Parrafo, Tabla, Titulo, Tramo
from convertitodo_mcp.convert.pdf_texto import pdf_a_bloques, pdf_a_docx, pdf_a_markdown
from convertitodo_mcp.errores import ErrorArgumento, ErrorConvertiTodo, ErrorLimiteExcedido
from convertitodo_mcp.read.deteccion import detectar_tipo
from convertitodo_mcp.render.pdf import renderizar_pdf
from convertitodo_mcp.server.config import Configuracion

Fixture = Callable[[str], bytes]


def _config(tmp_path: Path, max_bloques: int = 2000) -> Configuracion:
    return Configuracion(carpeta_trabajo=tmp_path, max_bloques=max_bloques)


def _t(texto: str) -> list[Tramo]:
    return [Tramo(texto=texto)]


def _pdf_conocido(config: Configuracion) -> bytes:
    bloques: list[Bloque] = [
        Titulo(nivel=1, texto=_t("Informe anual")),
        Parrafo(texto=_t("Primer párrafo del informe con datos de ejemplo.")),
        Titulo(nivel=2, texto=_t("Resultados")),
        Parrafo(texto=_t("Segundo párrafo con las conclusiones.")),
        Lista(items=[ItemLista(texto=_t(x)) for x in ("Manzana", "Banana", "Cereza")]),
        Tabla(encabezado=[_t("Nombre"), _t("Edad")], filas=[[_t("Ana"), _t("31")]]),
    ]
    return renderizar_pdf(bloques, config=config)


def test_markdown_conserva_frases_en_orden_y_titulos(
    fixture_bytes: Fixture, tmp_path: Path
) -> None:
    markdown = pdf_a_markdown(fixture_bytes("text.pdf"), _config(tmp_path))
    frases = ["Table Of Content", "Chapter 1", "Paragraph 1.1"]
    posiciones = [markdown.index(frase) for frase in frases]
    assert posiciones == sorted(posiciones)
    assert "# Chapter 1" in markdown
    assert "\n---" not in markdown


def test_docx_tiene_frases_y_estilo_de_titulo(fixture_bytes: Fixture, tmp_path: Path) -> None:
    datos = pdf_a_docx(fixture_bytes("text.pdf"), _config(tmp_path), titulo="Prueba")
    parrafos = Document(BytesIO(datos)).paragraphs
    textos = [p.text for p in parrafos]
    assert "Table Of Content" in textos
    assert "Chapter 1" in textos
    assert any(p.style is not None and p.style.name.startswith("Heading") for p in parrafos)
    assert detectar_tipo(datos, "salida.docx") == "docx"


def test_ida_y_vuelta_recupera_titulos_parrafos_items_y_celdas(tmp_path: Path) -> None:
    config = _config(tmp_path)
    markdown = pdf_a_markdown(_pdf_conocido(config), config)
    assert "# Informe anual" in markdown
    assert "## Resultados" in markdown
    for texto in (
        "Primer párrafo del informe con datos de ejemplo.",
        "Segundo párrafo con las conclusiones.",
        "Manzana",
        "Banana",
        "Cereza",
        "Nombre",
        "Edad",
        "Ana",
        "31",
    ):
        assert texto in markdown
    assert "- Manzana\n- Banana\n- Cereza" in markdown


def test_bloques_incluyen_titulos_y_lista(tmp_path: Path) -> None:
    config = _config(tmp_path)
    bloques = pdf_a_bloques(_pdf_conocido(config), config)
    assert sum(isinstance(b, Titulo) for b in bloques) == 2
    assert any(isinstance(b, Lista) and len(b.items) == 3 for b in bloques)


def test_texto_con_marcas_markdown_se_trata_como_dato(tmp_path: Path) -> None:
    config = _config(tmp_path)
    texto = "a*b_c [x](javascript:alert(1)) <b>y</b>"
    pdf = renderizar_pdf([Parrafo(texto=_t(texto))], config=config)
    bloques = pdf_a_bloques(pdf, config)
    assert len(bloques) == 1
    assert isinstance(bloques[0], Parrafo)
    assert "".join(t.texto for t in bloques[0].texto) == texto
    assert all(t.enlace is None and not t.negrita and not t.italica for t in bloques[0].texto)


@pytest.mark.parametrize(
    ("fixture", "fragmento"),
    [
        ("scanned.pdf", "escaneado"),
        ("protected.pdf", "contraseña"),
        ("corrupt.pdf", "No se pudo abrir"),
    ],
)
def test_pdf_invalido_da_error_claro(
    fixture_bytes: Fixture, tmp_path: Path, fixture: str, fragmento: str
) -> None:
    with pytest.raises(ErrorArgumento) as info:
        pdf_a_markdown(fixture_bytes(fixture), _config(tmp_path))
    mensaje = str(info.value)
    assert fragmento in mensaje
    assert "/" not in mensaje
    assert "Traceback" not in mensaje


def test_bytes_vacios_dan_error(tmp_path: Path) -> None:
    with pytest.raises(ErrorConvertiTodo):
        pdf_a_markdown(b"", _config(tmp_path))


def test_tope_de_bloques(tmp_path: Path) -> None:
    config = _config(tmp_path)
    pdf = _pdf_conocido(config)
    with pytest.raises(ErrorLimiteExcedido):
        pdf_a_bloques(pdf, _config(tmp_path, max_bloques=2))
