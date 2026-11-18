"""Integración MCP y HTTP de creación de planillas XLSX."""

from io import BytesIO
from pathlib import Path

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from openpyxl import load_workbook
from pydantic import SecretStr
from starlette.testclient import TestClient

from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.config import Configuracion


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_crear_xlsx_por_mcp_y_descargar_por_http(tmp_path: Path) -> None:
    token = "token-de-prueba-1234567890"  # noqa: S105
    config = Configuracion(carpeta_trabajo=tmp_path, transporte="http", token=SecretStr(token))
    servidor = crear_servidor(config)
    cabeceras = {"Authorization": f"Bearer {token}"}
    with TestClient(servidor.http_app()) as http:
        async with Client(servidor) as cliente:
            herramientas = {h.name: h for h in await cliente.list_tools()}
            herramienta = herramientas["crear_xlsx"]
            assert {"titulo", "hojas", "markdown", "csv", "opciones"} <= set(
                herramienta.input_schema["properties"]
            )
            assert herramienta.input_schema["required"] == ["titulo"]
            assert herramienta.annotations is not None
            assert herramienta.annotations.open_world_hint is False
            resultado = await cliente.call_tool(
                "crear_xlsx",
                {
                    "titulo": "Ventas 2026",
                    "hojas": [
                        {
                            "nombre": "Ventas",
                            "columnas": [
                                {"nombre": "Producto"},
                                {"nombre": "Precio", "tipo": "moneda"},
                            ],
                            "filas": [["Café", "1.500,50"], ["=cmd", 10]],
                            "fila_totales": True,
                        }
                    ],
                    "opciones": {"simbolo_moneda": "€"},
                },
            )
            datos = resultado.structured_content
            assert datos is not None
            assert datos["nombre"] == "Ventas 2026.xlsx"
            assert datos["hojas"] == ["Ventas"]
            descarga = http.get(str(datos["url"]), headers=cabeceras)
            assert descarga.status_code == 200
            assert http.get(str(datos["url"])).status_code == 401
    hoja = load_workbook(BytesIO(descarga.content))["Ventas"]
    assert hoja["B2"].value == pytest.approx(1500.5)
    assert hoja["B2"].number_format == '"€" #,##0.00'
    assert hoja["A3"].data_type == "s"
    assert hoja["B4"].value == "=SUBTOTAL(109,B2:B3)"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("argumentos", "hojas"),
    [
        ({"markdown": "| A | B |\n|---|---|\n| x | 1 |"}, ["Hoja1"]),
        ({"csv": "A;B\nx;1,5\n"}, ["Hoja1"]),
    ],
)
async def test_crear_xlsx_desde_texto(
    tmp_path: Path, argumentos: dict[str, str], hojas: list[str]
) -> None:
    async with Client(crear_servidor(Configuracion(carpeta_trabajo=tmp_path))) as cliente:
        resultado = await cliente.call_tool("crear_xlsx", {"titulo": "Rápida", **argumentos})
    assert resultado.structured_content is not None
    assert resultado.structured_content["hojas"] == hojas


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("argumentos", "mensaje"),
    [
        ({"titulo": "x"}, "exactamente una fuente"),
        ({"titulo": "x", "csv": "a\n1", "markdown": "|a|\n|-|\n|1|"}, "exactamente una fuente"),
        ({"titulo": " ", "csv": "a\n1"}, "título está vacío"),
        ({"titulo": "x", "hojas": []}, "no tiene hojas"),
        (
            {
                "titulo": "x",
                "hojas": [
                    {
                        "nombre": "H",
                        "columnas": [{"nombre": "N", "tipo": "numero"}],
                        "filas": [["muchos"]],
                    }
                ],
            },
            "columna 'N'",
        ),
        (
            {
                "titulo": "x",
                "hojas": [
                    {
                        "nombre": "H",
                        "columnas": [{"nombre": "N", "tipo": "numero"}],
                        "filas": [[{"formula": '=WEBSERVICE("http://x")'}]],
                    }
                ],
            },
            "no se reconoce",
        ),
        ({"titulo": "x", "hojas": [{"nombre": "H/1", "columnas": [{"nombre": "A"}]}]}, "hojas.0"),
    ],
)
async def test_errores_crear_xlsx(
    tmp_path: Path, argumentos: dict[str, object], mensaje: str
) -> None:
    async with Client(crear_servidor(Configuracion(carpeta_trabajo=tmp_path))) as cliente:
        with pytest.raises(ToolError) as error:
            await cliente.call_tool("crear_xlsx", argumentos)
    assert mensaje in str(error.value)
    assert str(tmp_path) not in str(error.value)
    assert "Traceback" not in str(error.value)


@pytest.mark.anyio
async def test_crear_xlsx_respeta_limite_de_filas(tmp_path: Path) -> None:
    config = Configuracion(carpeta_trabajo=tmp_path, max_filas=2)
    async with Client(crear_servidor(config)) as cliente:
        with pytest.raises(ToolError, match="máximo permitido es 2"):
            await cliente.call_tool("crear_xlsx", {"titulo": "x", "csv": "a\n1\n2\n3\n"})


@pytest.mark.anyio
async def test_editar_xlsx_conserva_original(tmp_path: Path) -> None:
    async with Client(crear_servidor(Configuracion(carpeta_trabajo=tmp_path))) as cliente:
        herramienta = {h.name: h for h in await cliente.list_tools()}["editar_xlsx"]
        assert set(herramienta.input_schema["required"]) == {"archivo", "operaciones"}
        creado = await cliente.call_tool("crear_xlsx", {"titulo": "Base", "csv": "A,B\nx,1\n"})
        assert creado.structured_content is not None
        original = creado.structured_content["id"]
        editado = await cliente.call_tool(
            "editar_xlsx",
            {
                "archivo": original,
                "operaciones": [
                    {"tipo": "agregar_filas", "hoja": "Hoja1", "filas": [["y", "2"]]},
                    {
                        "tipo": "agregar_hoja",
                        "hoja": {
                            "nombre": "Resumen",
                            "columnas": [{"nombre": "Total", "tipo": "numero"}],
                            "filas": [[{"formula": "=SUM(Hoja1!B2:B3)"}]],
                        },
                    },
                ],
            },
        )
        with pytest.raises(ToolError) as error:
            await cliente.call_tool(
                "editar_xlsx",
                {
                    "archivo": "../../secreto",
                    "operaciones": [{"tipo": "agregar_filas", "hoja": "H", "filas": [["x"]]}],
                },
            )
    datos = editado.structured_content
    assert datos is not None
    assert datos["id"] != original
    assert datos["nombre"] == "Base-editado.xlsx"
    assert datos["hojas"] == ["Hoja1", "Resumen"]
    assert str(tmp_path) not in str(error.value)
