"""Integración MCP y HTTP de creación y edición de documentos DOCX."""

from collections.abc import Callable
from io import BytesIO
from pathlib import Path

import pytest
from docx import Document
from docx.oxml.ns import qn
from fastmcp import Client
from fastmcp.exceptions import ToolError
from pydantic import SecretStr
from starlette.testclient import TestClient

from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.config import Configuracion


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_esquemas_y_flujo_docx_mcp_http(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    token = "token-de-prueba-1234567890"  # noqa: S105
    config = Configuracion(carpeta_trabajo=tmp_path, transporte="http", token=SecretStr(token))
    servidor = crear_servidor(config)
    cabeceras = {"Authorization": f"Bearer {token}"}
    plantilla = fixture_bytes("sample.docx")
    with TestClient(servidor.http_app()) as http:
        subida = http.post("/files?nombre=plantilla.docx", content=plantilla, headers=cabeceras)
        assert subida.status_code == 201
        id_plantilla = subida.json()["id"]
        async with Client(servidor) as cliente:
            herramientas = {
                herramienta.name: herramienta for herramienta in await cliente.list_tools()
            }
            crear_schema = herramientas["crear_docx"].input_schema
            editar_schema = herramientas["editar_docx"].input_schema
            assert {"titulo", "markdown", "bloques", "opciones"} <= set(crear_schema["properties"])
            assert {"archivo", "operaciones"} <= set(editar_schema["properties"])
            assert set(editar_schema["required"]) == {"archivo", "operaciones"}
            creacion = await cliente.call_tool(
                "crear_docx",
                {
                    "titulo": "Informe",
                    "markdown": "# Sección inicial\n\nTexto original",
                    "opciones": {"plantilla": id_plantilla, "tabla_contenido": True},
                },
            )
            creado = creacion.structured_content
            assert creado is not None
            descarga = http.get(str(creado["url"]), headers=cabeceras)
            assert descarga.status_code == 200
            assert http.get(str(creado["url"])).status_code == 401
            documento = Document(BytesIO(descarga.content))
            assert any("Texto original" in parrafo.text for parrafo in documento.paragraphs)
            assert any(
                'TOC \\o "1-6"' in (campo.get(qn("w:instr")) or "")
                for campo in documento.element.iter(qn("w:fldSimple"))
            )

            edicion = await cliente.call_tool(
                "editar_docx",
                {
                    "archivo": creado["id"],
                    "operaciones": [
                        {"tipo": "reemplazar_texto", "buscar": "original", "reemplazo": "editado"},
                        {
                            "tipo": "agregar_seccion",
                            "titulo": "Final",
                            "bloques": [{"tipo": "parrafo", "texto": "Contenido adicional"}],
                        },
                        {"tipo": "agregar_tabla", "tabla": {"tipo": "tabla", "filas": [["Celda"]]}},
                    ],
                },
            )
            editado = edicion.structured_content
            assert editado is not None
            assert editado["id"] != creado["id"]
            copia = http.get(str(editado["url"]), headers=cabeceras)
            assert copia.status_code == 200
            assert http.get(str(creado["url"]), headers=cabeceras).content == descarga.content
            assert http.get(str(subida.json()["url"]), headers=cabeceras).content == plantilla
        documento_editado = Document(BytesIO(copia.content))
        texto = "\n".join(parrafo.text for parrafo in documento_editado.paragraphs)
        assert "Texto editado" in texto
        assert "Contenido adicional" in texto
        assert documento_editado.tables[-1].cell(0, 0).text == "Celda"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "herramienta,argumentos",
    [
        ("crear_docx", {"titulo": "Informe", "markdown": "Texto", "opciones": {"tamano": "A3"}}),
        (
            "crear_docx",
            {"titulo": "Informe", "markdown": "Texto", "opciones": {"plantilla": "../../secreto"}},
        ),
        (
            "editar_docx",
            {
                "archivo": "../../secreto",
                "operaciones": [{"tipo": "reemplazar_texto", "buscar": "a", "reemplazo": "b"}],
            },
        ),
    ],
)
async def test_errores_docx_no_exponen_rutas(
    tmp_path: Path, herramienta: str, argumentos: dict[str, object]
) -> None:
    async with Client(crear_servidor(Configuracion(carpeta_trabajo=tmp_path))) as cliente:
        with pytest.raises(ToolError) as error:
            await cliente.call_tool(herramienta, argumentos)
    assert str(tmp_path) not in str(error.value)
    assert "Traceback" not in str(error.value)
