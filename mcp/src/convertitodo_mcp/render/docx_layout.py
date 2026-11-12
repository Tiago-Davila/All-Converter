"""Configuración de página e imágenes para documentos DOCX."""

import warnings
from io import BytesIO
from math import isfinite
from typing import Literal

from docx import Document
from docx.document import Document as DocumentoDOCX
from docx.enum.section import WD_ORIENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor
from PIL import Image as ImagenPIL
from PIL import UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from convertitodo_mcp.blocks import Imagen
from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado
from convertitodo_mcp.limites import verificar_tamano
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen


class MargenesDOCX(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    superior: float = Field(default=25, ge=0)
    inferior: float = Field(default=25, ge=0)
    izquierdo: float = Field(default=25, ge=0)
    derecho: float = Field(default=25, ge=0)


class OpcionesDOCX(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    tamano: Literal["A4", "Carta"] | None = None
    orientacion: Literal["vertical", "horizontal"] | None = None
    margenes: MargenesDOCX | None = None
    tabla_contenido: bool = False

    @model_validator(mode="after")
    def _validar_espacio(self) -> "OpcionesDOCX":
        ancho, alto = (210.0, 297.0) if self.tamano != "Carta" else (215.9, 279.4)
        if self.orientacion == "horizontal":
            ancho, alto = alto, ancho
        margenes = self.margenes or MargenesDOCX()
        if (
            ancho - margenes.izquierdo - margenes.derecho < 25.4
            or alto - margenes.superior - margenes.inferior < 25.4
        ):
            raise ValueError("Los márgenes deben dejar espacio suficiente para el contenido.")
        return self


def crear_documento(
    opciones: OpcionesDOCX,
    *,
    almacen: Almacen | None = None,
    config: Configuracion | None = None,
) -> DocumentoDOCX:
    """Crea un documento con dimensiones y estilos predeterminados."""
    documento = Document()
    seccion = documento.sections[0]
    ancho, alto = (210.0, 297.0) if opciones.tamano != "Carta" else (215.9, 279.4)
    if opciones.orientacion == "horizontal":
        ancho, alto = alto, ancho
        seccion.orientation = WD_ORIENT.LANDSCAPE
    else:
        seccion.orientation = WD_ORIENT.PORTRAIT
    seccion.page_width, seccion.page_height = Mm(ancho), Mm(alto)
    margenes = opciones.margenes or MargenesDOCX()
    seccion.top_margin, seccion.bottom_margin = Mm(margenes.superior), Mm(margenes.inferior)
    seccion.left_margin, seccion.right_margin = Mm(margenes.izquierdo), Mm(margenes.derecho)
    normal = documento.styles["Normal"]
    normal.font.name = "Noto Sans"
    normal.font.size = Pt(11)
    for nivel in range(1, 7):
        fuente = documento.styles[f"Heading {nivel}"].font
        fuente.name = "Noto Sans"
        fuente.color.rgb = RGBColor(0, 0, 0)
    return documento


def insertar_tabla_contenido(documento: DocumentoDOCX) -> None:
    """Inserta un campo de índice que Word actualizará al abrir el documento."""
    documento.add_paragraph("Tabla de contenido", style="Title")
    parrafo = documento.add_paragraph()
    campo = OxmlElement("w:fldSimple")
    campo.set(qn("w:instr"), r'TOC \o "1-6" \h \z \u')
    campo.set(qn("w:dirty"), "true")
    parrafo._p.append(campo)
    ajustes = documento.settings.element
    actualizacion = ajustes.find(qn("w:updateFields"))
    if actualizacion is None:
        actualizacion = OxmlElement("w:updateFields")
        ajustes.append(actualizacion)
    actualizacion.set(qn("w:val"), "true")


def insertar_imagen(
    documento: DocumentoDOCX,
    bloque: Imagen,
    *,
    almacen: Almacen | None = None,
    config: Configuracion | None = None,
) -> None:
    """Inserta una imagen local ajustada al área útil de la sección actual."""
    if almacen is None or config is None:
        raise ErrorArgumento(
            "No se configuró un almacén para cargar la imagen.",
            "configurá el almacén y volvé a intentar.",
        )
    if bloque.ancho_mm is not None and not isfinite(bloque.ancho_mm):
        raise ErrorArgumento("El ancho de la imagen no es finito.", "indicá un ancho válido en mm.")
    archivo = almacen.obtener(bloque.archivo)
    verificar_tamano(archivo.tamano, config, que="la imagen")
    with archivo.ruta.open("rb") as entrada:
        datos = entrada.read(config.max_bytes + 1)
    verificar_tamano(len(datos), config, que="la imagen")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", ImagenPIL.DecompressionBombWarning)
            with ImagenPIL.open(BytesIO(datos)) as imagen:
                imagen.verify()
            with ImagenPIL.open(BytesIO(datos)) as imagen:
                imagen.load()
                ancho_px, alto_px = imagen.size
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        ImagenPIL.DecompressionBombError,
        ImagenPIL.DecompressionBombWarning,
    ):
        raise ErrorFormatoNoSoportado(
            "La imagen no es válida o es demasiado grande para procesarla.",
            "subí una imagen válida con dimensiones menores.",
        ) from None
    seccion = documento.sections[-1]
    ancho_util = seccion.page_width - seccion.left_margin - seccion.right_margin
    alto_util = seccion.page_height - seccion.top_margin - seccion.bottom_margin
    ancho_deseado = Mm(bloque.ancho_mm) if bloque.ancho_mm is not None else Mm(ancho_px * 25.4 / 96)
    factor = min(ancho_deseado / ancho_px, ancho_util / ancho_px, alto_util / alto_px)
    imagen_docx = documento.add_picture(
        BytesIO(datos), width=int(ancho_px * factor), height=int(alto_px * factor)
    )
    imagen_docx._inline.docPr.set("descr", bloque.texto_alternativo)
