"""Lectura local mediante los conversores de MarkItDown."""

from __future__ import annotations

import csv
import re
from io import BytesIO, StringIO
from typing import Protocol, cast
from zipfile import ZipFile

from docx.oxml import parse_xml
from markitdown import StreamInfo
from markitdown.converters import (
    CsvConverter,
    DocxConverter,
    HtmlConverter,
    PdfConverter,
    PptxConverter,
    XlsxConverter,
)
from openpyxl.utils.cell import column_index_from_string, coordinate_from_string
from pypdf import PdfWriter

from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado, ErrorLimiteExcedido
from convertitodo_mcp.limites import verificar_filas, verificar_tamano
from convertitodo_mcp.read.modelos import DocumentoLeido, EntradaDocumento
from convertitodo_mcp.read.respaldo import (
    abrir_pdf,
    info_basica,
    leer_respaldo,
    verificar_texto_pdf,
)
from convertitodo_mcp.server.config import Configuracion


class _Resultado(Protocol):
    markdown: str


class _Conversor(Protocol):
    def convert(self, archivo: BytesIO, info: StreamInfo) -> _Resultado: ...


def _convertir(entrada: EntradaDocumento, datos: bytes) -> str:
    clases = {
        "pdf": PdfConverter,
        "docx": DocxConverter,
        "xlsx": XlsxConverter,
        "pptx": PptxConverter,
        "csv": CsvConverter,
        "html": HtmlConverter,
    }
    conversor = cast("_Conversor", clases[entrada.tipo]())
    resultado = conversor.convert(
        BytesIO(datos), StreamInfo(extension=f".{entrada.tipo}", charset="utf-8-sig")
    )
    return resultado.markdown


def _preflight_csv(datos: bytes, config: Configuracion) -> None:
    filas = 0
    columnas = 0
    for filas, fila in enumerate(csv.reader(StringIO(datos.decode("utf-8-sig"), newline="")), 1):
        columnas = max(columnas, len(fila))
        verificar_filas(filas, config, que="el CSV")
        verificar_tamano(filas * columnas * 8, config, que="el CSV expandido")


def _preflight_docx(datos: bytes, config: Configuracion) -> None:
    with ZipFile(BytesIO(datos)) as paquete:
        raiz = parse_xml(paquete.read("word/document.xml"))
    bloques = 0
    filas = 0
    for elemento in raiz.iter():
        etiqueta = elemento.tag
        if not isinstance(etiqueta, str):
            continue
        if etiqueta.endswith(("}p", "}tbl")):
            bloques += 1
            if bloques > config.max_bloques:
                raise ErrorLimiteExcedido(
                    f"El documento supera el máximo de {config.max_bloques} bloques.",
                    "dividí el documento en archivos más pequeños.",
                )
        elif etiqueta.endswith("}tr"):
            filas += 1
            verificar_filas(filas, config, que="el documento")


def _preflight_xlsx(datos: bytes, config: Configuracion) -> None:
    filas = 0
    with ZipFile(BytesIO(datos)) as paquete:
        for miembro in paquete.infolist():
            if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", miembro.filename):
                continue
            raiz = parse_xml(paquete.read(miembro))
            max_fila = 0
            max_columna = 0
            for elemento in raiz.iter():
                etiqueta = elemento.tag
                if not isinstance(etiqueta, str):
                    continue
                referencia = elemento.get("r", "")
                if etiqueta.endswith("}row") and referencia.isdigit():
                    max_fila = max(max_fila, int(referencia))
                elif etiqueta.endswith("}c") and referencia:
                    columna, fila = coordinate_from_string(referencia)
                    max_fila = max(max_fila, fila)
                    max_columna = max(max_columna, column_index_from_string(columna))
                elif etiqueta.endswith("}dimension") and referencia:
                    columna, fila = coordinate_from_string(referencia.split(":")[-1])
                    max_fila = max(max_fila, fila)
                    max_columna = max(max_columna, column_index_from_string(columna))
            filas += max_fila
            verificar_filas(filas, config)
            verificar_tamano(max_fila * max_columna * 8, config, que="la planilla expandida")


def _separar_hojas(texto: str, hojas: list[str]) -> list[str]:
    posiciones: list[int] = []
    for hoja in hojas:
        marca = f"## {hoja}\n"
        coincidencias = list(re.finditer(r"(?m)^" + re.escape(marca), texto))
        if len(coincidencias) != 1:
            raise ValueError("Separación ambigua de hojas")
        posiciones.append(coincidencias[0].start())
    if posiciones != sorted(posiciones) or (posiciones and posiciones[0] != 0):
        raise ValueError("Orden ambiguo de hojas")
    return [
        texto[inicio:fin].strip()
        for inicio, fin in zip(posiciones, [*posiciones[1:], len(texto)], strict=True)
    ]


def leer_markitdown(entrada: EntradaDocumento, config: Configuracion) -> DocumentoLeido:
    """Extrae Markdown sin cargar modelos de detección ni acceder a la red."""
    metadatos = info_basica(entrada, config)
    if entrada.tipo == "xlsx":
        _preflight_xlsx(entrada.datos, config)
    elif entrada.tipo == "docx":
        _preflight_docx(entrada.datos, config)
    elif entrada.tipo == "csv":
        _preflight_csv(entrada.datos, config)
    try:
        if entrada.tipo == "pdf":
            pdf = abrir_pdf(entrada.datos)
            paginas = []
            total = 0
            for pagina in pdf.pages:
                escritor = PdfWriter()
                escritor.add_page(pagina)
                salida = BytesIO()
                escritor.write(salida)
                texto = _convertir(entrada, salida.getvalue())
                total += len(texto.encode("utf-8"))
                verificar_tamano(total, config, que="el texto extraído")
                paginas.append(texto)
            verificar_texto_pdf(paginas)
        else:
            texto = _convertir(entrada, entrada.datos)
            verificar_tamano(len(texto.encode("utf-8")), config, que="el texto extraído")
            if not texto.strip():
                raise ValueError("Documento sin texto")
            if entrada.tipo == "xlsx":
                paginas = _separar_hojas(texto, metadatos.hojas)
            elif entrada.tipo == "pptx":
                partes = re.split(r"\n*<!-- Slide number: (\d+) -->\n", texto)
                if (
                    partes[0].strip()
                    or len(partes[1::2]) != metadatos.paginas
                    or partes[1::2] != [str(i) for i in range(1, len(partes[1::2]) + 1)]
                ):
                    raise ValueError("Separación ambigua de diapositivas")
                paginas = [parte.strip() for parte in partes[2::2]]
            else:
                paginas = [texto]
        return DocumentoLeido(tipo=entrada.tipo, paginas=paginas, hojas=metadatos.hojas)
    except (ErrorLimiteExcedido, ErrorArgumento):
        raise
    except Exception:
        if entrada.tipo in {"pdf", "docx", "xlsx"}:
            return leer_respaldo(entrada, config)
        raise ErrorFormatoNoSoportado(
            "No se pudo leer el documento.", "comprobá que el archivo sea válido."
        ) from None
