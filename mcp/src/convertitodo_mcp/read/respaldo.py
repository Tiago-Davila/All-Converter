"""Lectores locales de respaldo para PDF, DOCX y XLSX."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from io import BytesIO
from typing import Protocol, cast
from zipfile import ZipFile

from docx import Document
from docx.oxml import parse_xml
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from pypdf import PdfReader

from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
)
from convertitodo_mcp.limites import verificar_filas, verificar_tamano
from convertitodo_mcp.read.modelos import DocumentoLeido, EntradaDocumento, MetadatosDocumento
from convertitodo_mcp.server.config import Configuracion


class _Hoja(Protocol):
    def iter_rows(self, *, values_only: bool) -> Iterator[tuple[object, ...]]: ...


class _Libro(Protocol):
    sheetnames: list[str]

    def __getitem__(self, nombre: str) -> _Hoja: ...
    def close(self) -> None: ...


def abrir_pdf(datos: bytes) -> PdfReader:
    try:
        pdf = PdfReader(BytesIO(datos))
        if pdf.is_encrypted and not pdf.decrypt(""):
            raise ErrorArgumento(
                "El PDF está protegido con contraseña.", "usá una copia desbloqueada."
            )
        len(pdf.pages)
        return pdf
    except ErrorArgumento:
        raise
    except Exception:
        raise ErrorArgumento(
            "No se pudo abrir el PDF.", "exportalo de nuevo y reintentá."
        ) from None


def verificar_texto_pdf(paginas: Sequence[str]) -> None:
    """Pide OCR local si ninguna página contiene texto extraíble."""
    if not any(pagina.strip() for pagina in paginas):
        raise ErrorArgumento(
            "El PDF no contiene texto extraíble y podría estar escaneado.",
            "aplicá OCR local al documento y volvé a intentarlo.",
        )


def _escapar(valor: object) -> str:
    if valor is None:
        return ""
    return (
        str(valor)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", "<br>")
        .replace("\n", "<br>")
        .replace("\r", "<br>")
    )


def _tabla(filas: list[list[str]]) -> str:
    if not filas:
        return ""
    ancho = max(map(len, filas))
    lineas = ["| " + " | ".join(fila + [""] * (ancho - len(fila))) + " |" for fila in filas]
    lineas.insert(1, "| " + " | ".join(["---"] * ancho) + " |")
    return "\n".join(lineas)


def _docx(datos: bytes, config: Configuracion) -> list[str]:
    documento = Document(BytesIO(datos))
    partes: list[str] = []
    tamano = 0
    filas_total = 0
    for bloque in documento.iter_inner_content():
        if isinstance(bloque, Paragraph):
            texto = bloque.text
            estilo = bloque.style.name if bloque.style else ""
            if estilo.startswith("Heading ") and estilo[8:].isdigit():
                texto = "#" * min(int(estilo[8:]), 6) + " " + texto
        elif isinstance(bloque, Table):
            filas: list[list[str]] = []
            bytes_tabla = 0
            for fila in bloque.rows:
                filas_total += 1
                verificar_filas(filas_total, config, que="el documento")
                valores = [_escapar(celda.text) for celda in fila.cells]
                bytes_tabla += sum(len(valor.encode("utf-8")) + 3 for valor in valores) + 4
                verificar_tamano(tamano + bytes_tabla, config, que="el texto extraído")
                filas.append(valores)
            texto = _tabla(filas)
        else:
            continue
        tamano += len(texto.encode("utf-8")) + 2
        verificar_tamano(tamano, config, que="el texto extraído")
        if texto:
            partes.append(texto)
    return ["\n\n".join(partes)]


def _xlsx(datos: bytes, config: Configuracion) -> tuple[list[str], list[str]]:
    libro = cast(
        "_Libro", load_workbook(BytesIO(datos), read_only=True, data_only=True, keep_links=False)
    )
    try:
        paginas: list[str] = []
        total_filas = 0
        tamano = 0
        for nombre in libro.sheetnames:
            filas: list[list[str]] = []
            for fila in libro[nombre].iter_rows(values_only=True):
                total_filas += 1
                verificar_filas(total_filas, config)
                valores = [_escapar(valor) for valor in fila]
                tamano += (
                    sum(len(valor.encode("utf-8")) for valor in valores) + 3 * len(valores) + 4
                )
                verificar_tamano(tamano, config, que="el texto extraído")
                filas.append(valores)
            paginas.append(_tabla(filas))
        return paginas, list(libro.sheetnames)
    finally:
        libro.close()


def leer_respaldo(entrada: EntradaDocumento, config: Configuracion) -> DocumentoLeido:
    if entrada.tipo == "pdf":
        pdf = abrir_pdf(entrada.datos)
        if len(pdf.pages) > config.max_bloques:
            raise ErrorLimiteExcedido(
                f"El documento supera el máximo de {config.max_bloques} páginas.",
                "dividí el documento en archivos más pequeños.",
            )
        paginas: list[str] = []
        tamano = 0
        try:
            for pagina in pdf.pages:
                texto = pagina.extract_text() or ""
                tamano += len(texto.encode("utf-8"))
                verificar_tamano(tamano, config, que="el texto extraído")
                paginas.append(texto)
        except ErrorLimiteExcedido:
            raise
        except Exception:
            raise ErrorArgumento(
                "No se pudo leer el PDF.", "exportalo de nuevo y reintentá."
            ) from None
        verificar_texto_pdf(paginas)
        return DocumentoLeido(tipo=entrada.tipo, paginas=paginas)
    if entrada.tipo == "docx":
        return DocumentoLeido(tipo=entrada.tipo, paginas=_docx(entrada.datos, config))
    if entrada.tipo == "xlsx":
        paginas, hojas = _xlsx(entrada.datos, config)
        return DocumentoLeido(tipo=entrada.tipo, paginas=paginas, hojas=hojas)
    raise ErrorFormatoNoSoportado(
        "No hay lector de respaldo para este formato.", "usá un formato compatible."
    )


def info_basica(entrada: EntradaDocumento, config: Configuracion) -> MetadatosDocumento:
    """Cuenta unidades físicas o enumera hojas sin extraer su contenido."""
    paginas: int | None = None
    hojas: list[str] = []
    if entrada.tipo == "pdf":
        paginas = len(abrir_pdf(entrada.datos).pages)
    elif entrada.tipo == "xlsx":
        libro = cast(
            "_Libro",
            load_workbook(BytesIO(entrada.datos), read_only=True, data_only=True, keep_links=False),
        )
        try:
            hojas = list(libro.sheetnames)
        finally:
            libro.close()
    elif entrada.tipo == "pptx":
        with ZipFile(BytesIO(entrada.datos)) as paquete:
            presentacion = parse_xml(paquete.read("ppt/presentation.xml"))
        paginas = len(
            presentacion.findall(
                "{http://schemas.openxmlformats.org/presentationml/2006/main}sldIdLst/"
                "{http://schemas.openxmlformats.org/presentationml/2006/main}sldId"
            )
        )
    if (paginas if paginas is not None else len(hojas)) > config.max_bloques:
        raise ErrorLimiteExcedido(
            f"El documento supera el máximo de {config.max_bloques} unidades.",
            "dividí el documento en archivos más pequeños.",
        )
    return MetadatosDocumento(paginas=paginas, hojas=hojas)
