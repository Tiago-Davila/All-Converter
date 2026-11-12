"""Pruebas del renderizador PDF."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from pydantic import ValidationError
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import stringWidth

from convertitodo_mcp.blocks import Documento, Imagen, markdown_a_bloques
from convertitodo_mcp.errores import (
    ErrorArchivoNoEncontrado,
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
)
from convertitodo_mcp.render.fuentes import MONO, registrar_fuentes
from convertitodo_mcp.render.pdf import OpcionesPDF, _ajustar_codigo, _imagen_pdf, renderizar_pdf
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


def test_renderizar_bloques_basicos() -> None:
    documento = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "titulo", "texto": "Título & prueba"},
                {"tipo": "parrafo", "texto": [{"texto": "<etiqueta>", "negrita": True}]},
                {"tipo": "lista", "items": ["Primero", "Segundo"]},
                {"tipo": "tabla", "encabezado": ["Columna"], "filas": [["Celda"]]},
                {"tipo": "codigo", "texto": "a < b"},
                {"tipo": "salto_pagina"},
                {"tipo": "cita", "texto": "Cita"},
            ]
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(documento.bloques)))
    assert len(pdf.pages) == 2
    texto = "\n".join(pagina.extract_text() for pagina in pdf.pages)
    for esperado in ("Título & prueba", "<etiqueta>", "Primero", "Celda", "a < b", "Cita"):
        assert esperado in texto


def test_tabla_larga_repite_encabezado() -> None:
    documento = Documento.model_validate(
        {
            "bloques": [
                {
                    "tipo": "tabla",
                    "encabezado": ["Encabezado único", "Detalle"],
                    "filas": [[f"Fila {indice}", "Contenido"] for indice in range(80)],
                }
            ]
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(documento.bloques)))
    assert len(pdf.pages) > 1
    textos = [pagina.extract_text() for pagina in pdf.pages]
    assert all("Encabezado único" in texto for texto in textos)
    assert "Fila 79" in textos[-1]


def test_opciones_pagina_metadata_y_numeracion() -> None:
    bloques = Documento.model_validate(
        {
            "bloques": [
                {"tipo": "parrafo", "texto": "Primera"},
                {"tipo": "salto_pagina"},
                {"tipo": "parrafo", "texto": "Segunda"},
            ]
        }
    ).bloques
    opciones = OpcionesPDF.model_validate(
        {
            "tamano": "Carta",
            "orientacion": "horizontal",
            "titulo": "Informe",
            "autor": "Autora",
            "numerar_paginas": True,
            "margenes": {"superior": 30, "inferior": 30, "izquierdo": 35, "derecho": 35},
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(bloques, opciones)))
    assert pdf.metadata is not None
    assert pdf.metadata.title == "Informe"
    assert pdf.metadata.author == "Autora"
    assert float(pdf.pages[0].mediabox.width) == pytest.approx(792)
    assert float(pdf.pages[0].mediabox.height) == pytest.approx(612)
    for numero, pagina in enumerate(pdf.pages, start=1):
        assert str(numero) in pagina.extract_text().splitlines()


@pytest.mark.parametrize("valor", [float("nan"), float("inf"), -1, 500])
def test_margenes_invalidos(valor: float) -> None:
    with pytest.raises(ValidationError):
        OpcionesPDF.model_validate({"margenes": {"izquierdo": valor}})


def test_codigo_largo_se_ajusta_sin_perder_caracteres() -> None:
    registrar_fuentes()
    original = "  " + "x" * 200 + " fin"
    ajustado = _ajustar_codigo(original, 100)
    assert ajustado.replace("\n", "") == original
    assert all(stringWidth(linea, MONO, 9) <= 100 for linea in ajustado.split("\n"))


def test_numeracion_requiere_margen_inferior() -> None:
    with pytest.raises(ValidationError, match="margen inferior de al menos 10 mm"):
        OpcionesPDF.model_validate({"numerar_paginas": True, "margenes": {"inferior": 9}})


def test_imagen_de_almacen_se_incrusta_y_escala(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    config = Configuracion(carpeta_trabajo=tmp_path)
    bloque = Imagen(archivo=archivo.id, ancho_mm=1000)
    imagen = _imagen_pdf(bloque, almacen, config, 100, 40)
    assert imagen.drawWidth <= 100
    assert imagen.drawHeight <= 40
    assert imagen.drawWidth / imagen.drawHeight == pytest.approx(
        imagen.imageWidth / imagen.imageHeight
    )
    pdf = PdfReader(BytesIO(renderizar_pdf([bloque], almacen=almacen, config=config)))
    assert pdf.pages[0].images


def test_imagen_invalida_o_inexistente(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path)
    archivo = almacen.guardar_subida("invalida.png", b"no es una imagen")
    with pytest.raises(ErrorFormatoNoSoportado):
        renderizar_pdf([Imagen(archivo=archivo.id)], almacen=almacen, config=config)
    with pytest.raises(ErrorArchivoNoEncontrado):
        renderizar_pdf([Imagen(archivo="A" * 22)], almacen=almacen, config=config)
    with pytest.raises(ErrorArgumento):
        renderizar_pdf(
            [Imagen(archivo=archivo.id, ancho_mm=float("inf"))], almacen=almacen, config=config
        )


def test_imagen_excede_limite(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> None:
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    config = Configuracion(carpeta_trabajo=tmp_path, max_mb=0)
    with pytest.raises(ErrorLimiteExcedido):
        renderizar_pdf([Imagen(archivo=archivo.id)], almacen=almacen, config=config)


def test_markdown_fixture_unicode_y_formato(fixture_bytes: Callable[[str], bytes]) -> None:
    markdown = fixture_bytes("sample.md").decode("utf-8")
    markdown += "\n\nEspañol: ñ, áéíóú, €; **negrita**, *itálica*, `código`.\n"
    pdf = PdfReader(BytesIO(renderizar_pdf(markdown_a_bloques(markdown))))
    texto = "\n".join(pagina.extract_text() for pagina in pdf.pages)
    for esperado in (
        "Informe de ventas",
        "Café",
        "Chocolate",
        "negrita",
        "itálica",
        "npm run ci",
        "ñ, áéíóú, €",
        "código",
        "la guía interna",
    ):
        assert esperado in texto
    enlaces = [
        anotacion.get_object() for pagina in pdf.pages for anotacion in pagina.get("/Annots", [])
    ]
    assert any(
        enlace.get("/A", {}).get("/URI") == "https://ejemplo.local/guia" for enlace in enlaces
    )


def test_tabla_500_filas_completa() -> None:
    documento = Documento.model_validate(
        {
            "bloques": [
                {
                    "tipo": "tabla",
                    "encabezado": ["Código único", "Valor"],
                    "filas": [[f"FILA-{i:03d}-FIN", f"VALOR-{i:03d}-FIN"] for i in range(500)],
                }
            ]
        }
    )
    pdf = PdfReader(BytesIO(renderizar_pdf(documento.bloques)))
    textos = [pagina.extract_text() for pagina in pdf.pages]
    assert len(textos) > 1
    assert all("Código único" in texto for texto in textos)
    texto = "\n".join(textos)
    for i in range(500):
        assert texto.count(f"FILA-{i:03d}-FIN") == 1
        assert texto.count(f"VALOR-{i:03d}-FIN") == 1


def test_elemento_que_no_cabe_da_error_seguro() -> None:
    secreto = "CONTENIDO_PRIVADO"
    documento = Documento.model_validate(
        {
            "bloques": [
                {
                    "tipo": "tabla",
                    "filas": [[(secreto + "\n") * 1000]],
                }
            ]
        }
    )
    with pytest.raises(ErrorArgumento) as info:
        renderizar_pdf(documento.bloques)
    assert "no cabe" in str(info.value)
    assert secreto not in str(info.value)
