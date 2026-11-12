"""Operaciones de edición que conservan la estructura del documento original."""

from io import BytesIO
from typing import Annotated, Literal, cast

from docx.document import Document
from docx.opc.part import Part
from docx.oxml.ns import qn
from docx.oxml.xmlchemy import BaseOxmlElement
from docx.parts.hdrftr import FooterPart, HeaderPart
from pydantic import BaseModel, ConfigDict, Field

from convertitodo_mcp.blocks import Bloque, Tabla, Titulo
from convertitodo_mcp.limites import verificar_tamano
from convertitodo_mcp.render.docx import agregar_bloques
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


class AgregarSeccion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["agregar_seccion"]
    titulo: str = Field(min_length=1, description="Título de la sección agregada al final.")
    nivel: int = Field(default=1, ge=1, le=6)
    bloques: list[Bloque] = Field(default_factory=list)


class ReemplazarTexto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["reemplazar_texto"]
    buscar: str = Field(min_length=1, description="Texto literal que se busca en cada párrafo.")
    reemplazo: str = Field(description="Texto que sustituye cada coincidencia.")


class AgregarTabla(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tipo: Literal["agregar_tabla"]
    tabla: Tabla = Field(description="Bloque de tabla que se agrega al final.")


OperacionDOCX = Annotated[
    AgregarSeccion | ReemplazarTexto | AgregarTabla, Field(discriminator="tipo")
]


def bloques_operaciones(operaciones: list[OperacionDOCX]) -> list[Bloque]:
    bloques: list[Bloque] = []
    for operacion in operaciones:
        if isinstance(operacion, AgregarSeccion):
            bloques.append(
                Titulo.model_validate({"texto": operacion.titulo, "nivel": operacion.nivel})
            )
            bloques.extend(operacion.bloques)
        elif isinstance(operacion, AgregarTabla):
            bloques.append(operacion.tabla)
    return bloques


def _reemplazar_en_parrafo(
    parrafo: BaseOxmlElement, buscar: str, reemplazo: str, acumulado: int, config: Configuracion
) -> int:
    nodos = list(parrafo.iter(qn("w:t")))
    texto = "".join(nodo.text or "" for nodo in nodos)
    cantidad = texto.count(buscar)
    tamano = len(texto.encode("utf-8")) + cantidad * (
        len(reemplazo.encode("utf-8")) - len(buscar.encode("utf-8"))
    )
    acumulado += tamano
    verificar_tamano(acumulado, config, que="el texto resultante")
    posiciones: list[int] = []
    inicio = 0
    while (indice := texto.find(buscar, inicio)) != -1:
        posiciones.append(indice)
        inicio = indice + len(buscar)
    # Se trabaja de derecha a izquierda para mantener las posiciones originales.
    for indice in reversed(posiciones):
        fin = indice + len(buscar)
        desplazamiento = 0
        primero = True
        for nodo in nodos:
            actual = nodo.text or ""
            siguiente = desplazamiento + len(actual)
            if desplazamiento < fin and siguiente > indice:
                desde = max(0, indice - desplazamiento)
                hasta = min(len(actual), fin - desplazamiento)
                nodo.text = actual[:desde] + (reemplazo if primero else "") + actual[hasta:]
                nodo.set(qn("xml:space"), "preserve")
                primero = False
            desplazamiento = siguiente
    return acumulado


def editar_documento(
    documento: Document,
    operaciones: list[OperacionDOCX],
    *,
    almacen: Almacen,
    config: Configuracion,
) -> bytes:
    """Edita cuerpo, tablas, encabezados y pies; no busca entre párrafos."""
    for operacion in operaciones:
        if isinstance(operacion, ReemplazarTexto):
            partes: list[BaseOxmlElement] = [documento.element.body]
            relacionadas = cast("dict[str, Part]", documento.part.related_parts)
            partes.extend(
                cast("BaseOxmlElement", parte.element)
                for parte in relacionadas.values()
                if isinstance(parte, HeaderPart | FooterPart)
            )
            vistas: set[int] = set()
            acumulado = 0
            for parte in partes:
                if id(parte) in vistas:
                    continue
                vistas.add(id(parte))
                for parrafo in parte.iter(qn("w:p")):
                    acumulado = _reemplazar_en_parrafo(
                        cast("BaseOxmlElement", parrafo),
                        operacion.buscar,
                        operacion.reemplazo,
                        acumulado,
                        config,
                    )
        else:
            agregar_bloques(
                documento, bloques_operaciones([operacion]), almacen=almacen, config=config
            )
    salida = BytesIO()
    documento.save(salida)
    return salida.getvalue()
