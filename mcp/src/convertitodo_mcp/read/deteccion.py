"""Detección y validación acotada de documentos locales."""

from io import BytesIO
from pathlib import PurePath
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZipFile

from docx.oxml import parse_xml

from convertitodo_mcp.errores import ErrorArgumento, ErrorFormatoNoSoportado
from convertitodo_mcp.limites import verificar_tamano
from convertitodo_mcp.read.modelos import EntradaDocumento, TipoDocumento
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage.almacen import Almacen

_PARTES: dict[str, TipoDocumento] = {
    "word/document.xml": "docx",
    "xl/workbook.xml": "xlsx",
    "ppt/presentation.xml": "pptx",
}


def _invalido() -> ErrorFormatoNoSoportado:
    return ErrorFormatoNoSoportado(
        "El archivo no tiene un formato válido o contiene recursos no permitidos.",
        "subí un documento válido sin macros ni recursos externos.",
    )


def detectar_tipo(datos: bytes, nombre: str) -> TipoDocumento:
    """Reconoce firmas binarias antes de considerar la extensión de texto."""
    if not datos:
        raise ErrorArgumento("El archivo está vacío.", "subí un documento con contenido.")
    if datos.startswith(b"%PDF-"):
        return "pdf"
    if datos.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        try:
            with ZipFile(BytesIO(datos)) as paquete:
                nombres = set(paquete.namelist())
                tipos = [tipo for parte, tipo in _PARTES.items() if parte in nombres]
                if len(tipos) == 1 and {"[Content_Types].xml", "_rels/.rels"} <= nombres:
                    return tipos[0]
        except (BadZipFile, OSError, ValueError):
            pass
        raise _invalido()
    inicio = datos.lstrip().lower()
    if inicio.startswith((b"<!doctype html", b"<html", b"<head", b"<body")):
        return "html"
    extension = PurePath(nombre).suffix.lower()
    if extension not in {".csv", ".html", ".htm"}:
        raise _invalido()
    try:
        texto = datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _invalido() from None
    if any(ord(c) < 32 and c not in "\t\r\n" for c in texto):
        raise _invalido()
    return "csv" if extension == ".csv" else "html"


def _validar_paquete(datos: bytes, config: Configuracion) -> None:
    try:
        with ZipFile(BytesIO(datos)) as paquete:
            miembros = paquete.infolist()
            nombres = [miembro.filename for miembro in miembros]
            if len(nombres) != len(set(nombres)):
                raise ValueError
            extensiones = {PurePath(nombre).suffix.lower().lstrip(".") for nombre in nombres}
            verificar_tamano(
                sum(miembro.file_size for miembro in miembros),
                config,
                que="el documento descomprimido",
            )
            for miembro in miembros:
                nombre = miembro.filename.lower()
                if (
                    miembro.flag_bits & 1
                    or nombre.startswith("/")
                    or "\\" in nombre
                    or ".." in nombre.split("/")
                    or nombre.endswith((".bin", ".exe"))
                ):
                    raise ValueError
                if not nombre.endswith((".xml", ".rels")):
                    continue
                contenido = paquete.read(miembro)
                if (
                    b"\x00" in contenido
                    or b"<!doctype" in contenido.lower()
                    or b"<!entity" in contenido.lower()
                ):
                    raise ValueError
                try:
                    raiz = parse_xml(contenido)
                except Exception:
                    raise ValueError from None
                if nombre == "[content_types].xml":
                    for elemento in raiz:
                        tipo = elemento.get("ContentType", "").lower()
                        if not any(m in tipo for m in ("macroenabled", "vba", "oleobject")):
                            continue
                        # Un tipo por defecto (por ejemplo .bin en archivos de SheetJS) solo es
                        # un riesgo si el paquete tiene alguna parte con esa extensión.
                        extension = elemento.get("Extension")
                        if extension is not None and extension.lower() not in extensiones:
                            continue
                        raise ValueError
                if nombre.endswith(".rels"):
                    for elemento in raiz:
                        if elemento.get("TargetMode", "").lower() == "external":
                            tipo = elemento.get("Type", "")
                            destino = elemento.get("Target", "")
                            if not tipo.endswith("/hyperlink") or urlsplit(
                                destino
                            ).scheme.lower() not in {"http", "https", "mailto"}:
                                raise ValueError
    except (BadZipFile, OSError, ValueError, RuntimeError):
        raise _invalido() from None


def cargar_entrada(archivo: str, almacen: Almacen, config: Configuracion) -> EntradaDocumento:
    """Carga un id del almacén con límites antes de abrirlo con un conversor."""
    guardado = almacen.obtener(archivo)
    verificar_tamano(guardado.tamano, config, que="el documento")
    with guardado.ruta.open("rb") as entrada:
        datos = entrada.read(config.max_bytes + 1)
    verificar_tamano(len(datos), config, que="el documento")
    tipo = detectar_tipo(datos, guardado.nombre)
    if tipo in {"docx", "xlsx", "pptx"}:
        _validar_paquete(datos, config)
    return EntradaDocumento(guardado.nombre, tipo, datos)
