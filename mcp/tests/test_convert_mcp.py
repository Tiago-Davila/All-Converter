"""Integración MCP de las herramientas convertir y listar_conversiones."""

import io
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from openpyxl import load_workbook
from pypdf import PdfReader

from convertitodo_mcp.convert.registro import detectar_origen
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _preparar(tmp_path: Path) -> tuple[Configuracion, Almacen]:
    carpeta = tmp_path / "trabajo"
    return Configuracion(carpeta_trabajo=carpeta), Almacen(carpeta)


def _salidas(almacen: Almacen) -> set[str]:
    return {archivo.id for archivo in almacen.listar("outputs")}


def _leer(almacen: Almacen, resultado: dict[str, Any], posicion: int = 0) -> tuple[str, bytes]:
    archivo = resultado["archivos"][posicion]
    guardado = almacen.obtener(archivo["id"])
    assert guardado.zona == "outputs"
    assert archivo["url"] == f"/files/{archivo['id']}"
    assert archivo["tamano"] == len(guardado.ruta.read_bytes())
    return archivo["nombre"], guardado.ruta.read_bytes()


@pytest.mark.anyio
async def test_herramientas_publicadas_con_esquema(tmp_path: Path) -> None:
    config, _ = _preparar(tmp_path)
    async with Client(crear_servidor(config)) as cliente:
        herramientas = {h.name: h for h in await cliente.list_tools()}
    convertir = herramientas["convertir"]
    listar = herramientas["listar_conversiones"]
    propiedades = convertir.input_schema["properties"]
    assert {"archivo", "formato_destino", "opciones"} <= set(propiedades)
    assert convertir.input_schema["required"] == ["archivo", "formato_destino"]
    assert "archivo" in listar.input_schema["properties"]
    assert convertir.description is not None
    assert 'convertir(archivo="<id>", formato_destino="docx")' in convertir.description
    assert listar.description is not None
    assert "antes de convertir" in listar.description
    assert convertir.annotations is not None
    assert convertir.annotations.read_only_hint is False
    assert convertir.annotations.open_world_hint is False
    assert listar.annotations is not None
    assert listar.annotations.read_only_hint is True
    assert listar.annotations.idempotent_hint is True


@pytest.mark.anyio
async def test_listar_conversiones_completo_y_por_archivo(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    pdf = almacen.guardar_subida("text.pdf", fixture_bytes("text.pdf"))
    md = almacen.guardar_subida("sample.md", fixture_bytes("sample.md"))
    async with Client(crear_servidor(config)) as cliente:
        todo = (await cliente.call_tool("listar_conversiones", {})).structured_content
        assert todo is not None
        assert isinstance(todo["ffmpeg_disponible"], bool)
        origenes = {o["origen"]: o for o in todo["conversiones"]}
        assert {"pdf", "docx", "xlsx", "csv", "json", "png", "mp3", "mp4"} <= set(origenes)
        audio = origenes["mp3"]["destinos"]
        assert all(d["disponible"] == todo["ffmpeg_disponible"] for d in audio)
        pdf_docx = next(d for d in origenes["pdf"]["destinos"] if d["destino"] == "docx")
        assert pdf_docx["fidelidad_parcial"] is True
        uno = (
            await cliente.call_tool("listar_conversiones", {"archivo": pdf.id})
        ).structured_content
        assert uno is not None
        assert uno["tipo"] == "pdf"
        assert [o["origen"] for o in uno["conversiones"]] == ["pdf"]
        destinos = [d["destino"] for d in uno["conversiones"][0]["destinos"]]
        assert destinos == ["pdf", "png", "jpg", "docx", "md"]
        markdown = (
            await cliente.call_tool("listar_conversiones", {"archivo": md.id})
        ).structured_content
        assert markdown is not None
        assert markdown["conversiones"] == []
        assert "crear_pdf" in markdown["nota"]
        with pytest.raises(ToolError):
            await cliente.call_tool("listar_conversiones", {"archivo": "no-existe-0123456789"})


@pytest.mark.anyio
async def test_pdf_a_docx_declara_fidelidad_parcial(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    pdf = almacen.guardar_subida("Informe final.pdf", fixture_bytes("text.pdf"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir", {"archivo": pdf.id, "formato_destino": "docx"}
        )
    datos = resultado.structured_content
    assert datos is not None
    assert (datos["origen"], datos["destino"]) == ("pdf", "docx")
    assert datos["aviso"] is not None
    assert "parcial" in datos["aviso"].lower()
    nombre, contenido = _leer(almacen, datos)
    assert nombre == "Informe final.docx"
    assert detectar_origen(contenido, nombre) == "docx"


@pytest.mark.anyio
async def test_pdf_a_png_con_paginas(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> None:
    config, almacen = _preparar(tmp_path)
    pdf = almacen.guardar_subida("text.pdf", fixture_bytes("text.pdf"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir",
            {"archivo": pdf.id, "formato_destino": "png", "opciones": {"paginas": "1"}},
        )
    datos = resultado.structured_content
    assert datos is not None
    assert len(datos["archivos"]) == 1
    assert datos["aviso"] is None
    nombre, contenido = _leer(almacen, datos)
    assert nombre.endswith(".png")
    assert detectar_origen(contenido, nombre) == "png"


@pytest.mark.anyio
async def test_unir_pdf_suma_paginas(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> None:
    config, almacen = _preparar(tmp_path)
    original = fixture_bytes("text.pdf")
    primero = almacen.guardar_subida("a.pdf", original)
    segundo = almacen.guardar_subida("b.pdf", original)
    paginas = len(PdfReader(io.BytesIO(original)).pages)
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir",
            {
                "archivo": primero.id,
                "formato_destino": "pdf",
                "opciones": {"operacion": "unir", "archivos_adicionales": [segundo.id]},
            },
        )
    datos = resultado.structured_content
    assert datos is not None
    nombre, contenido = _leer(almacen, datos)
    assert nombre == "a-unido.pdf"
    assert len(PdfReader(io.BytesIO(contenido)).pages) == paginas * 2


@pytest.mark.anyio
async def test_docx_a_pdf(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> None:
    config, almacen = _preparar(tmp_path)
    docx = almacen.guardar_subida("sample.docx", fixture_bytes("sample.docx"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir", {"archivo": docx.id, "formato_destino": "pdf"}
        )
    datos = resultado.structured_content
    assert datos is not None
    assert datos["aviso"] is not None
    nombre, contenido = _leer(almacen, datos)
    assert nombre == "sample.pdf"
    assert detectar_origen(contenido, nombre) == "pdf"
    assert len(PdfReader(io.BytesIO(contenido)).pages) >= 1


@pytest.mark.anyio
async def test_xlsx_con_varias_hojas_a_csv(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    xlsx = almacen.guardar_subida("multisheet.xlsx", fixture_bytes("multisheet.xlsx"))
    hojas = len(load_workbook(io.BytesIO(fixture_bytes("multisheet.xlsx"))).worksheets)
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir", {"archivo": xlsx.id, "formato_destino": "csv"}
        )
    datos = resultado.structured_content
    assert datos is not None
    assert len(datos["archivos"]) == hojas >= 2
    for posicion in range(hojas):
        nombre, contenido = _leer(almacen, datos, posicion)
        assert nombre.endswith(".csv")
        assert detectar_origen(contenido, nombre) == "csv"


@pytest.mark.anyio
async def test_png_a_jpg_con_ancho_maximo(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    png = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir",
            {"archivo": png.id, "formato_destino": "jpg", "opciones": {"ancho_maximo": 10}},
        )
    datos = resultado.structured_content
    assert datos is not None
    nombre, contenido = _leer(almacen, datos)
    assert nombre == "sample.jpg"
    assert detectar_origen(contenido, nombre) == "jpg"
    from PIL import Image

    with Image.open(io.BytesIO(contenido)) as imagen:
        assert imagen.width == 10


@pytest.mark.anyio
async def test_png_a_pdf_con_imagen_adicional(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    primera = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    segunda = almacen.guardar_subida("images.png", fixture_bytes("images.png"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir",
            {
                "archivo": primera.id,
                "formato_destino": "pdf",
                "opciones": {"archivos_adicionales": [segunda.id]},
            },
        )
    datos = resultado.structured_content
    assert datos is not None
    nombre, contenido = _leer(almacen, datos)
    assert detectar_origen(contenido, nombre) == "pdf"
    assert len(PdfReader(io.BytesIO(contenido)).pages) == 2


@pytest.mark.anyio
@pytest.mark.parametrize("alias", ["JPEG", ".jpg", " Jpg "])
async def test_alias_de_formato_jpg(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], alias: str
) -> None:
    config, almacen = _preparar(tmp_path)
    png = almacen.guardar_subida("sample.png", fixture_bytes("sample.png"))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir", {"archivo": png.id, "formato_destino": alias}
        )
    assert resultado.structured_content is not None
    assert resultado.structured_content["destino"] == "jpg"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("archivo", "alias", "destino"),
    [
        ("text.pdf", ".docx", "docx"),
        ("text.pdf", "Markdown", "md"),
        ("multisheet.xlsx", "JSON", "json"),
        ("sample.csv", "Excel", "xlsx"),
        ("text.pdf", "Word", "docx"),
    ],
)
async def test_alias_de_formato(
    tmp_path: Path,
    fixture_bytes: Callable[[str], bytes],
    archivo: str,
    alias: str,
    destino: str,
) -> None:
    config, almacen = _preparar(tmp_path)
    subido = almacen.guardar_subida(archivo, fixture_bytes(archivo))
    async with Client(crear_servidor(config)) as cliente:
        resultado = await cliente.call_tool(
            "convertir", {"archivo": subido.id, "formato_destino": alias}
        )
    assert resultado.structured_content is not None
    assert resultado.structured_content["destino"] == destino


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("archivo", "destino", "opciones", "fragmentos"),
    [
        ("text.pdf", "xlsx", None, ["pdf, png, jpg, docx, md"]),
        ("sample.docx", "csv", None, ["pdf, xlsx"]),
        ("text.pdf", "", None, ["formato_destino"]),
        ("text.pdf", "pdf", None, ["unir, dividir, rotar"]),
        ("sample.png", "jpg", {"dpi": 100}, ["«dpi»", "calidad, ancho_maximo"]),
        ("text.pdf", "png", {"archivos_adicionales": ["abc"]}, ["archivos_adicionales"]),
        ("sample.md", "pdf", None, ["crear_pdf", "crear_docx"]),
    ],
)
async def test_errores_de_herramienta_en_espanol(
    tmp_path: Path,
    fixture_bytes: Callable[[str], bytes],
    archivo: str,
    destino: str,
    opciones: dict[str, Any] | None,
    fragmentos: list[str],
) -> None:
    config, almacen = _preparar(tmp_path)
    subido = almacen.guardar_subida(archivo, fixture_bytes(archivo))
    antes = _salidas(almacen)
    argumentos: dict[str, Any] = {"archivo": subido.id, "formato_destino": destino}
    if opciones is not None:
        argumentos["opciones"] = opciones
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError) as error:
            await cliente.call_tool("convertir", argumentos)
    mensaje = str(error.value)
    for fragmento in fragmentos:
        assert fragmento in mensaje
    assert "Traceback" not in mensaje
    assert str(tmp_path) not in mensaje
    assert _salidas(almacen) == antes


@pytest.mark.anyio
async def test_id_inexistente_y_opcion_desconocida(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    config, almacen = _preparar(tmp_path)
    subido = almacen.guardar_subida("text.pdf", fixture_bytes("text.pdf"))
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError) as inexistente:
            await cliente.call_tool(
                "convertir", {"archivo": "abcdefghijklmnopqrstuv", "formato_destino": "docx"}
            )
        assert "No existe un archivo" in str(inexistente.value)
        with pytest.raises(ToolError):
            await cliente.call_tool(
                "convertir",
                {
                    "archivo": subido.id,
                    "formato_destino": "docx",
                    "opciones": {"inventada": 1},
                },
            )
    assert _salidas(almacen) == set()


@pytest.mark.anyio
async def test_tope_de_archivos_de_salida_no_guarda_nada(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    from convertitodo_mcp.server import convertir as modulo

    monkeypatch.setattr(modulo, "MAX_ARCHIVOS_SALIDA", 1)
    config, almacen = _preparar(tmp_path)
    pdf = almacen.guardar_subida("text.pdf", fixture_bytes("text.pdf"))
    antes = _salidas(almacen)
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError) as error:
            await cliente.call_tool(
                "convertir",
                {
                    "archivo": pdf.id,
                    "formato_destino": "pdf",
                    "opciones": {"operacion": "dividir"},
                },
            )
    assert "máximo es 1" in str(error.value)
    assert _salidas(almacen) == antes
