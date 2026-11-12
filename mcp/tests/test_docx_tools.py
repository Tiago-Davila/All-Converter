"""Pruebas de la herramienta de creación DOCX."""

from io import BytesIO
from collections.abc import Callable
from pathlib import Path
from threading import Event

import anyio
import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE
from fastmcp.exceptions import ToolError

from convertitodo_mcp.blocks import Documento
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.render.docx_edit import AgregarSeccion, AgregarTabla, ReemplazarTexto
from convertitodo_mcp.server.docx import crear_herramienta_docx, crear_herramienta_editar_docx
from convertitodo_mcp.storage import Almacen


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_crear_docx_markdown_y_bloques(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    crear = crear_herramienta_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    bloques = Documento.model_validate({"bloques": [{"tipo": "parrafo", "texto": "Segundo"}]})
    for resultado, texto in (
        (await crear("Informe", markdown="# Primero"), "Primero"),
        (await crear("Otro", bloques=bloques.bloques), "Segundo"),
    ):
        assert resultado.nombre.endswith(".docx")
        assert resultado.url == f"/files/{resultado.id}"
        documento = Document(BytesIO(almacen.leer(resultado.id)))
        assert any(texto in parrafo.text for parrafo in documento.paragraphs)


@pytest.mark.anyio
@pytest.mark.parametrize(
    "titulo,markdown,bloques",
    [
        ("", "Texto", None),
        ("T" * 256, "Texto", None),
        ("Título", None, None),
        ("Título", "Texto", []),
        ("Título", "   ", None),
        ("Título", None, []),
    ],
)
async def test_crear_docx_rechaza_entrada_invalida(
    tmp_path: Path, titulo: str, markdown: str | None, bloques: list[object] | None
) -> None:
    almacen = Almacen(tmp_path)
    crear = crear_herramienta_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    # Los únicos valores de bloques de este caso son None y una lista vacía.
    with pytest.raises(ToolError):
        await crear(titulo, markdown=markdown, bloques=[] if bloques is not None else None)
    assert almacen.listar("outputs") == []


@pytest.mark.anyio
async def test_editar_docx_crea_copia_con_seccion_y_tabla(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    original = fixture_bytes("sample.docx")
    archivo = almacen.guardar_subida("sample.docx", original)
    editar = crear_herramienta_editar_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    tabla = AgregarTabla.model_validate(
        {"tipo": "agregar_tabla", "tabla": {"tipo": "tabla", "filas": [["Celda nueva"]]}}
    )
    seccion = AgregarSeccion.model_validate(
        {
            "tipo": "agregar_seccion",
            "titulo": "Sección nueva",
            "bloques": [{"tipo": "parrafo", "texto": "Texto nuevo"}],
        }
    )
    resultado = await editar(archivo.id, [seccion, tabla])
    assert resultado.id != archivo.id
    assert almacen.leer(archivo.id) == original
    documento = Document(BytesIO(almacen.leer(resultado.id)))
    assert any(p.text == "Sección nueva" for p in documento.paragraphs)
    assert any(p.text == "Texto nuevo" for p in documento.paragraphs)
    assert documento.tables[-1].cell(0, 0).text == "Celda nueva"


@pytest.mark.anyio
async def test_reemplazo_entre_runs_conserva_formato(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    documento = Document()
    parrafo = documento.add_paragraph()
    parrafo.add_run("Antes ab").bold = True
    parrafo.add_run("cd después").italic = True
    enlace = OxmlElement("w:hyperlink")
    enlace.set(
        qn("r:id"), parrafo.part.relate_to("https://ejemplo.com", RELATIONSHIP_TYPE.HYPERLINK, True)
    )
    enlace_run = OxmlElement("w:r")
    enlace_texto = OxmlElement("w:t")
    enlace_texto.text = " enlace"
    enlace_run.append(enlace_texto)
    enlace.append(enlace_run)
    parrafo._p.append(enlace)
    documento.add_picture(BytesIO(fixture_bytes("sample.png")))
    documento.sections[0].header.paragraphs[0].text = "abcd"
    datos = BytesIO()
    documento.save(datos)
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("original.docx", datos.getvalue())
    editar = crear_herramienta_editar_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    operacion = ReemplazarTexto(tipo="reemplazar_texto", buscar="abcd", reemplazo="XYZ")
    resultado = await editar(archivo.id, [operacion])
    editado = Document(BytesIO(almacen.leer(resultado.id)))
    assert editado.paragraphs[0].text == "Antes XYZ después enlace"
    assert editado.paragraphs[0].runs[0].bold
    assert editado.paragraphs[0].runs[1].italic
    assert editado.sections[0].header.paragraphs[0].text == "XYZ"
    assert len(editado.inline_shapes) == 1
    assert len(editado.paragraphs[0].hyperlinks) == 1
    assert almacen.leer(archivo.id) == datos.getvalue()


@pytest.mark.anyio
async def test_reemplazo_rechaza_expansion_excesiva(tmp_path: Path) -> None:
    documento = Document()
    documento.add_paragraph("a" * 200)
    datos = BytesIO()
    documento.save(datos)
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("original.docx", datos.getvalue())
    editar = crear_herramienta_editar_docx(
        almacen, Configuracion(carpeta_trabajo=tmp_path, max_mb=1)
    )
    operacion = ReemplazarTexto(tipo="reemplazar_texto", buscar="a", reemplazo="x" * 6000)
    with pytest.raises(ToolError, match="máximo"):
        await editar(archivo.id, [operacion])
    assert almacen.leer(archivo.id) == datos.getvalue()
    assert almacen.listar("outputs") == []


@pytest.mark.anyio
async def test_reemplazo_no_crea_encabezados_ni_pies(tmp_path: Path) -> None:
    documento = Document()
    documento.add_paragraph("Antes")
    datos = BytesIO()
    documento.save(datos)
    almacen = Almacen(tmp_path)
    archivo = almacen.guardar_subida("original.docx", datos.getvalue())
    editar = crear_herramienta_editar_docx(almacen, Configuracion(carpeta_trabajo=tmp_path))
    operacion = ReemplazarTexto(tipo="reemplazar_texto", buscar="Antes", reemplazo="Después")
    resultado = await editar(archivo.id, [operacion])
    editado = Document(BytesIO(almacen.leer(resultado.id)))
    assert editado.sections[0].header.is_linked_to_previous
    assert editado.sections[0].footer.is_linked_to_previous


@pytest.mark.anyio
async def test_crear_docx_aplica_limites(tmp_path: Path) -> None:
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path, max_bloques=1, max_filas=1)
    crear = crear_herramienta_docx(almacen, config)
    with pytest.raises(ToolError, match="bloques"):
        await crear("Título", markdown="Uno\n\nDos")
    tabla = Documento.model_validate({"bloques": [{"tipo": "tabla", "filas": [["a"], ["b"]]}]})
    crear_filas = crear_herramienta_docx(almacen, config.model_copy(update={"max_bloques": 10}))
    with pytest.raises(ToolError, match="filas"):
        await crear_filas("Título", bloques=tabla.bloques)
    crear_bytes = crear_herramienta_docx(almacen, config.model_copy(update={"max_mb": 0}))
    with pytest.raises(ToolError, match="máximo"):
        await crear_bytes("Título", markdown="Texto")
    assert almacen.listar("outputs") == []


@pytest.mark.anyio
async def test_timeout_no_guarda_salida_tardia(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import convertitodo_mcp.server.docx as modulo

    inicio, continuar, terminado = Event(), Event(), Event()

    def render_lento(*args: object, **kwargs: object) -> bytes:
        inicio.set()
        continuar.wait(3)
        terminado.set()
        return b"resultado tardio"

    monkeypatch.setattr(modulo, "renderizar_docx", render_lento)
    almacen = Almacen(tmp_path)
    config = Configuracion(carpeta_trabajo=tmp_path, timeout_s=1)
    crear = crear_herramienta_docx(almacen, config)
    try:
        with pytest.raises(ToolError, match="canceló"):
            await crear("Título", markdown="Texto")
        assert inicio.is_set()
    finally:
        continuar.set()
    assert await anyio.to_thread.run_sync(terminado.wait, 3)
    assert almacen.listar("outputs") == []
