"""Unir, dividir y rotar PDF con pypdf, sin tocar el disco ni la red."""

from __future__ import annotations

import re
from collections.abc import Sequence
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject

from convertitodo_mcp.convert.tipos import SalidaConversion
from convertitodo_mcp.errores import ErrorArgumento, ErrorLimiteExcedido
from convertitodo_mcp.read.respaldo import abrir_pdf

MAX_PDFS_A_UNIR = 50
# Tope de páginas de entrada (suma de todos los PDF) y de salida de una operación.
MAX_PAGINAS = 2000

_EJEMPLO_RANGOS = '"1-3,5,7-"'
_GRADOS_VALIDOS = (90, 180, 270)
_FRAGMENTO = re.compile(r"([0-9]*)\s*-\s*([0-9]*)|([0-9]+)", re.ASCII)
# Acciones y anotaciones que no se arrastran a la salida.
_ACCIONES_ACTIVAS = frozenset(
    {"/JavaScript", "/Launch", "/ImportData", "/SubmitForm", "/Rendition"}
)
_ANOTACIONES_ACTIVAS = frozenset({"/FileAttachment", "/Sound", "/Movie", "/Screen"})


def interpretar_rangos(texto: str, total_paginas: int) -> list[tuple[int, int]]:
    """Convierte "1-3,5,7-" en rangos inclusivos 1-based; no deduplica ni reordena."""
    if not texto.strip():
        raise ErrorArgumento(
            "No se indicó ningún rango de páginas.", f"indicá rangos como {_EJEMPLO_RANGOS}."
        )
    rangos: list[tuple[int, int]] = []
    for crudo in texto.split(","):
        fragmento = crudo.strip()
        coincide = _FRAGMENTO.fullmatch(fragmento)
        if coincide is None or fragmento == "-":
            raise ErrorArgumento(
                f'El rango "{fragmento}" no es válido.',
                f"usá números de página separados por comas, por ejemplo {_EJEMPLO_RANGOS}.",
            )
        if coincide.group(3) is not None:
            inicio = fin = int(coincide.group(3))
        else:
            inicio = int(coincide.group(1)) if coincide.group(1) else 1
            fin = int(coincide.group(2)) if coincide.group(2) else total_paginas
        if inicio < 1 or fin < 1 or inicio > fin:
            raise ErrorArgumento(
                f'El rango "{fragmento}" no es válido.',
                f"las páginas empiezan en 1 y el inicio no puede superar al final, "
                f"por ejemplo {_EJEMPLO_RANGOS}.",
            )
        if fin > total_paginas:
            raise ErrorArgumento(
                f'El rango "{fragmento}" no existe en un PDF de {total_paginas} páginas.',
                f"usá páginas entre 1 y {total_paginas}.",
            )
        rangos.append((inicio, fin))
    return rangos


def paginas_de_rangos(rangos: Sequence[tuple[int, int]]) -> list[int]:
    """Aplana los rangos a números de página 1-based, conservando orden y repeticiones."""
    return [pagina for inicio, fin in rangos for pagina in range(inicio, fin + 1)]


def contar_paginas(datos: bytes) -> int:
    """Cuenta las páginas del PDF; falla con error claro si está protegido o dañado."""
    return len(abrir_pdf(datos).pages)


def _verificar_total(total: int) -> None:
    if total > MAX_PAGINAS:
        raise ErrorLimiteExcedido(
            f"La operación supera el máximo de {MAX_PAGINAS} páginas.",
            "usá menos páginas o dividí el trabajo en pasos más chicos.",
        )


def _es_activa(anotacion: DictionaryObject) -> bool:
    if str(anotacion.get("/Subtype")) in _ANOTACIONES_ACTIVAS or "/AA" in anotacion:
        return True
    accion = anotacion.get("/A")
    if accion is None:
        return False
    accion = accion.get_object()
    return isinstance(accion, DictionaryObject) and str(accion.get("/S")) in _ACCIONES_ACTIVAS


def _agregar_pagina(escritor: PdfWriter, lector: PdfReader, indice: int) -> None:
    # Se omiten las acciones de página y las anotaciones activas; los enlaces comunes se conservan.
    pagina = escritor.add_page(lector.pages[indice], excluded_keys=("/AA",))
    anotaciones = pagina.get("/Annots")
    if anotaciones is None:
        return
    seguras = ArrayObject()
    for referencia in anotaciones.get_object():
        anotacion = referencia.get_object()
        if isinstance(anotacion, DictionaryObject) and not _es_activa(anotacion):
            seguras.append(referencia)
    if seguras:
        pagina[NameObject("/Annots")] = seguras
    else:
        del pagina["/Annots"]


def _serializar(escritor: PdfWriter) -> bytes:
    salida = BytesIO()
    escritor.write(salida)
    return salida.getvalue()


def unir_pdfs(pdfs: Sequence[bytes]) -> bytes:
    """Une los PDF en el orden recibido; el resultado no conserva marcadores ni formularios."""
    if len(pdfs) < 2:
        raise ErrorArgumento(
            "Para unir PDF se necesitan al menos dos archivos.", "indicá dos o más PDF."
        )
    if len(pdfs) > MAX_PDFS_A_UNIR:
        raise ErrorLimiteExcedido(
            f"No se pueden unir más de {MAX_PDFS_A_UNIR} PDF a la vez.",
            f"unilos en tandas de hasta {MAX_PDFS_A_UNIR}.",
        )
    lectores: list[PdfReader] = []
    total = 0
    for posicion, datos in enumerate(pdfs, start=1):
        try:
            lector = abrir_pdf(datos)
        except ErrorArgumento as error:
            raise ErrorArgumento(
                f"El PDF número {posicion}: {error.que_fallo}", error.como_corregir
            ) from None
        total += len(lector.pages)
        _verificar_total(total)
        lectores.append(lector)
    escritor = PdfWriter()
    for lector in lectores:
        for indice in range(len(lector.pages)):
            _agregar_pagina(escritor, lector, indice)
    return _serializar(escritor)


def dividir_pdf(
    datos: bytes, rangos: str | None = None, *, nombre_base: str = "documento"
) -> list[SalidaConversion]:
    """Genera un PDF por página, o uno por cada rango indicado."""
    lector = abrir_pdf(datos)
    total = len(lector.pages)
    if rangos is None:
        lista = [(n, n) for n in range(1, total + 1)]
    else:
        lista = interpretar_rangos(rangos, total)
    _verificar_total(sum(fin - inicio + 1 for inicio, fin in lista))
    salidas: list[SalidaConversion] = []
    for inicio, fin in lista:
        escritor = PdfWriter()
        for numero in range(inicio, fin + 1):
            _agregar_pagina(escritor, lector, numero - 1)
        sufijo = f"p{inicio}" if inicio == fin else f"p{inicio}-{fin}"
        salidas.append(SalidaConversion(f"{nombre_base}-{sufijo}.pdf", _serializar(escritor)))
    return salidas


def rotar_pdf(datos: bytes, grados: int, paginas: str | None = None) -> bytes:
    """Rota en sentido horario, sumando a la rotación existente de las páginas elegidas."""
    if grados not in _GRADOS_VALIDOS:
        raise ErrorArgumento(
            f"La rotación de {grados} grados no es válida.", "usá 90, 180 o 270 grados."
        )
    lector = abrir_pdf(datos)
    total = len(lector.pages)
    _verificar_total(total)
    if paginas is None:
        elegidas = set(range(1, total + 1))
    else:
        elegidas = set(paginas_de_rangos(interpretar_rangos(paginas, total)))
    escritor = PdfWriter()
    for indice in range(total):
        _agregar_pagina(escritor, lector, indice)
        if indice + 1 in elegidas:
            escritor.pages[indice].rotate(grados)
    return _serializar(escritor)
