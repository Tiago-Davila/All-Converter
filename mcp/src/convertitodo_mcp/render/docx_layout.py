"""Configuración de página e imágenes para documentos DOCX."""

import warnings
from io import BytesIO
from math import isfinite
from typing import Literal, cast
from urllib.parse import urlsplit
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from docx import Document
from docx.document import Document as DocumentoDOCX
from docx.enum.section import WD_ORIENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor
from docx.styles.style import _ParagraphStyle
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
    plantilla: str | None = None

    @model_validator(mode="after")
    def _validar_espacio(self) -> "OpcionesDOCX":
        if self.plantilla is not None:
            return self
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
    if opciones.plantilla is not None:
        if almacen is None or config is None:
            raise ErrorArgumento(
                "No se configuró un almacén para la plantilla.",
                "configurá el almacén y volvé a intentar.",
            )
        documento = cargar_documento(opciones.plantilla, almacen, config)
    else:
        documento = Document()
    for seccion in documento.sections:
        ancho_actual, alto_actual = seccion.page_width, seccion.page_height
        if ancho_actual is None or alto_actual is None:
            raise ErrorArgumento(
                "La sección no tiene dimensiones válidas.",
                "usá una plantilla con dimensiones de página definidas.",
            )
        if opciones.tamano is not None or opciones.plantilla is None:
            ancho, alto = (210.0, 297.0) if opciones.tamano != "Carta" else (215.9, 279.4)
        else:
            ancho, alto = sorted((ancho_actual.mm, alto_actual.mm))
        horizontal = (
            opciones.orientacion == "horizontal"
            if opciones.orientacion is not None
            else seccion.orientation == WD_ORIENT.LANDSCAPE
            if opciones.plantilla is not None
            else False
        )
        if (
            opciones.tamano is not None
            or opciones.orientacion is not None
            or opciones.plantilla is None
        ):
            if horizontal:
                ancho, alto = alto, ancho
            seccion.orientation = WD_ORIENT.LANDSCAPE if horizontal else WD_ORIENT.PORTRAIT
            seccion.page_width, seccion.page_height = Mm(ancho), Mm(alto)
        margenes = opciones.margenes or (MargenesDOCX() if opciones.plantilla is None else None)
        if margenes is not None:
            campos = (
                margenes.model_fields_set
                if opciones.plantilla is not None
                else {"superior", "inferior", "izquierdo", "derecho"}
            )
            if "superior" in campos:
                seccion.top_margin = Mm(margenes.superior)
            if "inferior" in campos:
                seccion.bottom_margin = Mm(margenes.inferior)
            if "izquierdo" in campos:
                seccion.left_margin = Mm(margenes.izquierdo)
            if "derecho" in campos:
                seccion.right_margin = Mm(margenes.derecho)
        dimensiones = (
            seccion.page_width,
            seccion.page_height,
            seccion.left_margin,
            seccion.right_margin,
            seccion.top_margin,
            seccion.bottom_margin,
        )
        ancho_p, alto_p, izquierda, derecha, arriba, abajo = dimensiones
        if (
            ancho_p is None
            or alto_p is None
            or izquierda is None
            or derecha is None
            or arriba is None
            or abajo is None
        ):
            raise ErrorArgumento(
                "La sección no tiene márgenes válidos.", "usá una plantilla con márgenes definidos."
            )
        if (
            min(ancho_p, alto_p, izquierda, derecha, arriba, abajo) < 0
            or ancho_p - izquierda - derecha < Mm(25.4)
            or alto_p - arriba - abajo < Mm(25.4)
        ):
            raise ErrorArgumento(
                "Los márgenes no dejan espacio suficiente para el contenido.",
                "reducí los márgenes o cambiá el tamaño de página.",
            )
    if opciones.plantilla is not None:
        return documento
    normal = cast(_ParagraphStyle, documento.styles["Normal"])
    normal.font.name = "Noto Sans"
    normal.font.size = Pt(11)
    for nivel in range(1, 7):
        fuente = cast(_ParagraphStyle, documento.styles[f"Heading {nivel}"]).font
        fuente.name = "Noto Sans"
        fuente.color.rgb = RGBColor(0, 0, 0)
    return documento


def cargar_documento(archivo: str, almacen: Almacen, config: Configuracion) -> DocumentoDOCX:
    """Abre un DOCX local después de validar su contenido y tamaño."""
    guardado = almacen.obtener(archivo)
    verificar_tamano(guardado.tamano, config, que="el documento")
    with guardado.ruta.open("rb") as entrada:
        datos = entrada.read(config.max_bytes + 1)
    verificar_tamano(len(datos), config, que="el documento")
    try:
        with ZipFile(BytesIO(datos)) as paquete:
            entradas = paquete.infolist()
            nombres = [entrada.filename for entrada in entradas]
            if (
                len(nombres) != len(set(nombres))
                or "[Content_Types].xml" not in nombres
                or "word/document.xml" not in nombres
                or "_rels/.rels" not in nombres
                or sum(entrada.file_size for entrada in entradas) > config.max_bytes
            ):
                raise ValueError
            for entrada in entradas:
                nombre = entrada.filename.lower()
                if (
                    entrada.flag_bits & 1
                    or nombre.startswith("/")
                    or "\\" in nombre
                    or ".." in nombre.split("/")
                    or nombre.endswith((".bin", ".exe"))
                ):
                    raise ValueError
                contenido = paquete.read(entrada)
                if nombre.endswith((".xml", ".rels")):
                    if (
                        b"\x00" in contenido
                        or b"<!doctype" in contenido.lower()
                        or b"<!entity" in contenido.lower()
                    ):
                        raise ValueError
                    raiz = ElementTree.fromstring(contenido)
                    if nombre == "[content_types].xml":
                        tipos = " ".join(e.get("ContentType", "").lower() for e in raiz)
                        if "macroenabled" in tipos or "vba" in tipos or "oleobject" in tipos:
                            raise ValueError
                        if "wordprocessingml.document.main+xml" not in tipos:
                            raise ValueError
                    if nombre.endswith(".rels"):
                        for relacion in raiz:
                            if relacion.get("TargetMode", "").lower() == "external":
                                tipo = relacion.get("Type", "")
                                destino = relacion.get("Target", "")
                                if not tipo.endswith("/hyperlink") or urlsplit(
                                    destino
                                ).scheme.lower() not in {"http", "https", "mailto"}:
                                    raise ValueError
    except (BadZipFile, KeyError, OSError, ValueError, ElementTree.ParseError, RuntimeError):
        raise ErrorFormatoNoSoportado(
            "El documento DOCX no es válido o contiene recursos no permitidos.",
            "subí un DOCX válido sin macros ni recursos externos activos.",
        ) from None
    try:
        return Document(BytesIO(datos))
    except Exception:
        raise ErrorFormatoNoSoportado(
            "El documento DOCX no es válido o está dañado.",
            "subí un DOCX válido.",
        ) from None


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
    ancho, alto = seccion.page_width, seccion.page_height
    izquierda, derecha = seccion.left_margin, seccion.right_margin
    arriba, abajo = seccion.top_margin, seccion.bottom_margin
    if (
        ancho is None
        or alto is None
        or izquierda is None
        or derecha is None
        or arriba is None
        or abajo is None
    ):
        raise ErrorArgumento(
            "La sección no tiene dimensiones o márgenes válidos.",
            "usá una plantilla con dimensiones y márgenes definidos.",
        )
    ancho_util = ancho - izquierda - derecha
    alto_util = alto - arriba - abajo
    if min(ancho, alto, izquierda, derecha, arriba, abajo) < 0 or min(ancho_util, alto_util) <= 0:
        raise ErrorArgumento(
            "La sección no deja espacio suficiente para la imagen.",
            "reducí los márgenes o cambiá el tamaño de página.",
        )
    ancho_deseado = Mm(bloque.ancho_mm) if bloque.ancho_mm is not None else Mm(ancho_px * 25.4 / 96)
    factor = min(ancho_deseado / ancho_px, ancho_util / ancho_px, alto_util / alto_px)
    imagen_docx = documento.add_picture(
        BytesIO(datos), width=int(ancho_px * factor), height=int(alto_px * factor)
    )
    imagen_docx._inline.docPr.set("descr", bloque.texto_alternativo)
