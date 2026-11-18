"""Paridad de punta a punta: cada conversión de la tabla con los fixtures de la app web."""

from __future__ import annotations

import csv
import io
import json
import wave
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any, cast, get_args

import pytest
from docx import Document
from fastmcp import Client
from fastmcp.exceptions import ToolError
from openpyxl import Workbook, load_workbook
from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from convertitodo_mcp.convert.medios import detectar_medio, ffmpeg_disponible
from convertitodo_mcp.convert.registro import (
    TABLA,
    Conversion,
    OpcionesConversion,
    TipoOrigen,
    buscar_conversion,
    destinos_para,
    detectar_origen,
)
from convertitodo_mcp.server.app import crear_servidor
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

Verificador = Callable[["Salida"], None]
Tabla = list[list[str]]

_SIN_FFMPEG = ffmpeg_disponible() is None
_DPI_PRUEBA = 36
_DURACION_AUDIO_S = 3.0
_FRASES_TEXT_PDF = ("Table Of Content", "Chapter 1", "Paragraph 1.1")
_FORMATO_PILLOW = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}
_IMAGENES = ("png", "jpg", "webp")
_AUDIOS = ("mp3", "wav", "ogg", "m4a")
# Errores de contenido legítimos: el archivo es del tipo correcto pero no sirve para el destino.
_ERRORES_DE_CONTENIDO = (
    "escaneado",
    "contraseña",
    "No se pudo abrir",
    "no tiene tablas",
    "no tiene audio",
    "animado",
)
_DESTINOS_POSIBLES = (
    "pdf",
    "png",
    "jpg",
    "webp",
    "docx",
    "xlsx",
    "csv",
    "json",
    "md",
    "txt",
    "html",
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "mp4",
)

# Entradas que no son fixtures: se generan con la propia herramienta y se reutilizan.
_GENERADAS: dict[str, tuple[str, str]] = {
    "gen.jpg": ("sample.png", "jpg"),
    "gen.webp": ("sample.png", "webp"),
    "gen.wav": ("sample.mp3", "wav"),
    "gen.ogg": ("sample.mp3", "ogg"),
    "gen.m4a": ("sample.mp3", "m4a"),
}
_CACHE_GENERADAS: dict[str, bytes] = {}


# PDF de una página con texto real, mucho más liviano que text.pdf para los barridos.
def _pdf_pequeno() -> bytes:
    buffer = io.BytesIO()
    lienzo = canvas.Canvas(buffer, pagesize=(300, 200))
    lienzo.setFont("Helvetica-Bold", 20)
    lienzo.drawString(20, 150, "Titulo de prueba")
    lienzo.setFont("Helvetica", 11)
    lienzo.drawString(20, 120, "Un parrafo corto con texto real.")
    lienzo.save()
    return buffer.getvalue()


_SINTETICAS: dict[str, Callable[[], bytes]] = {"pequeno.pdf": _pdf_pequeno}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# Resultado de una conversión ya leído del almacén, para los verificadores de cada caso.
@dataclass(eq=False)
class Salida:
    nombre: str
    entrada: bytes
    archivos: list[tuple[str, bytes]]
    adicionales: list[bytes]


# Caso declarativo de la matriz: una conversión con su entrada, opciones y verificador.
@dataclass(eq=False)
class Caso:
    origen: str
    destino: str
    entrada: str
    verificar: Verificador
    opciones: dict[str, Any] = field(default_factory=dict)
    adicionales: tuple[str, ...] = ()
    etiqueta: str = ""

    @property
    def id(self) -> str:
        return self.etiqueta or f"{self.entrada}-{self.destino}"

    @property
    def clave(self) -> tuple[str, str, str | None]:
        return (self.origen, self.destino, self.opciones.get("operacion"))


# Servidor en memoria con su almacén; agrupa las llamadas y comprobaciones repetidas.
class Banco:
    def __init__(
        self,
        raiz: Path,
        almacen: Almacen,
        cliente: Client[Any],
        leer_fixture: Callable[[str], bytes],
    ) -> None:
        self.raiz = raiz
        self.almacen = almacen
        self.cliente = cliente
        self.leer_fixture = leer_fixture

    def subir(self, nombre: str, datos: bytes) -> str:
        return self.almacen.guardar_subida(nombre, datos).id

    def salidas(self) -> set[str]:
        return {a.id for a in self.almacen.listar("outputs")}

    def subidas(self) -> dict[str, bytes]:
        return {a.id: a.ruta.read_bytes() for a in self.almacen.listar("uploads")}

    # Devuelve (nombre de subida, bytes); las generadas se crean una vez con la herramienta.
    async def entrada(self, clave: str) -> tuple[str, bytes]:
        if clave in _SINTETICAS:
            return clave, _SINTETICAS[clave]()
        if clave not in _GENERADAS:
            return clave, self.leer_fixture(clave)
        if clave not in _CACHE_GENERADAS:
            fuente, destino = _GENERADAS[clave]
            salidas = await self.convertir_bytes(fuente, self.leer_fixture(fuente), destino)
            _CACHE_GENERADAS[clave] = salidas[0][1]
        return f"generada.{clave[4:]}", _CACHE_GENERADAS[clave]

    async def convertir(
        self, archivo: str, destino: str, opciones: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        argumentos: dict[str, Any] = {"archivo": archivo, "formato_destino": destino}
        if opciones:
            argumentos["opciones"] = opciones
        resultado = await self.cliente.call_tool("convertir", argumentos)
        assert resultado.structured_content is not None
        return resultado.structured_content

    async def listar(self, archivo: str) -> dict[str, Any]:
        resultado = await self.cliente.call_tool("listar_conversiones", {"archivo": archivo})
        assert resultado.structured_content is not None
        return resultado.structured_content

    # Lee cada archivo devuelto verificando id, zona, tamaño, url y nombre.
    def leer(self, resultado: dict[str, Any]) -> list[tuple[str, bytes]]:
        leidos: list[tuple[str, bytes]] = []
        for archivo in resultado["archivos"]:
            guardado = self.almacen.obtener(archivo["id"])
            contenido = guardado.ruta.read_bytes()
            assert guardado.zona == "outputs"
            assert archivo["tamano"] == len(contenido) == guardado.tamano
            assert archivo["nombre"] == guardado.nombre
            assert archivo["url"] == f"/files/{archivo['id']}"
            assert Path(archivo["nombre"]).name == archivo["nombre"]
            leidos.append((archivo["nombre"], contenido))
        return leidos

    async def convertir_bytes(
        self,
        nombre: str,
        datos: bytes,
        destino: str,
        opciones: dict[str, Any] | None = None,
    ) -> list[tuple[str, bytes]]:
        resultado = await self.convertir(self.subir(nombre, datos), destino, opciones)
        return self.leer(resultado)

    # Exige un error de herramienta limpio y sin efectos en outputs/ ni en uploads/.
    async def esperar_error(
        self,
        archivo: str,
        destino: str,
        opciones: dict[str, Any] | None = None,
        *,
        fragmentos: tuple[str, ...] = (),
        secretos: tuple[str, ...] = (),
    ) -> str:
        salidas = self.salidas()
        subidas = self.subidas()
        with pytest.raises(ToolError) as error:
            await self.convertir(archivo, destino, opciones)
        mensaje = str(error.value)
        for fragmento in fragmentos:
            assert fragmento in mensaje
        assert "Cómo corregirlo" in mensaje
        assert str(self.raiz) not in mensaje
        assert "Traceback" not in mensaje
        assert "site-packages" not in mensaje
        for secreto in secretos:
            assert secreto not in mensaje
        assert self.salidas() == salidas
        assert self.subidas() == subidas
        return mensaje


@asynccontextmanager
async def _banco(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> AsyncIterator[Banco]:
    carpeta = tmp_path / "trabajo"
    config = Configuracion(carpeta_trabajo=carpeta)
    async with Client(crear_servidor(config)) as cliente:
        yield Banco(tmp_path, Almacen(carpeta), cliente, fixture_bytes)


# ---------------------------------------------------------------- lectura de resultados


def _norm(valor: object) -> str:
    if valor is None:
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor)


# Extraer texto con pypdf es lento en text.pdf: se cachea por contenido y página.
@cache
def _texto_pagina(datos: bytes, indice: int) -> str:
    return PdfReader(io.BytesIO(datos)).pages[indice].extract_text()


def _texto_pdf(datos: bytes) -> str:
    return "\n".join(_texto_pagina(datos, i) for i in range(_paginas(datos)))


def _paginas(datos: bytes) -> int:
    return len(PdfReader(io.BytesIO(datos)).pages)


def _tabla_csv(datos: bytes) -> Tabla:
    return [list(fila) for fila in csv.reader(io.StringIO(datos.decode("utf-8-sig")))]


def _tabla_json(registros: list[dict[str, object]]) -> Tabla:
    columnas = list(registros[0])
    return [columnas, *([_norm(r.get(c)) for c in columnas] for r in registros)]


# Normaliza xlsx, csv o json a {hoja: tabla de textos con encabezado} para comparar datos.
def _hojas(formato: str, datos: bytes) -> dict[str, Tabla]:
    if formato == "xlsx":
        libro = load_workbook(io.BytesIO(datos))
        return {
            h.title: [[_norm(c) for c in fila] for fila in h.iter_rows(values_only=True)]
            for h in libro.worksheets
        }
    if formato == "csv":
        return {"hoja": _tabla_csv(datos)}
    cargado = json.loads(datos.decode("utf-8-sig"))
    if isinstance(cargado, dict):
        return {nombre: _tabla_json(registros) for nombre, registros in cargado.items()}
    return {"hoja": _tabla_json(cargado)}


def _imagen(datos: bytes) -> tuple[str, tuple[int, int], Image.Image]:
    with Image.open(io.BytesIO(datos)) as abierta:
        abierta.load()
        return str(abierta.format), abierta.size, abierta.convert("RGB")


# ---------------------------------------------------------------- verificadores


def _ver_planilla(origen: str, destino: str) -> Verificador:
    def verificar(s: Salida) -> None:
        esperado = _hojas(origen, s.entrada)
        if destino == "pdf":
            assert len(s.archivos) == 1
            texto = _texto_pdf(s.archivos[0][1])
            for tabla in esperado.values():
                for celda in (c for fila in tabla for c in fila if c):
                    assert celda in texto
            return
        if destino == "csv":
            assert len(s.archivos) == len(esperado)
            assert [_tabla_csv(d) for _, d in s.archivos] == list(esperado.values())
            if len(esperado) > 1:
                for (nombre, _), hoja in zip(s.archivos, esperado, strict=True):
                    assert hoja in nombre
            return
        assert len(s.archivos) == 1
        obtenido = _hojas(destino, s.archivos[0][1])
        assert list(obtenido.values()) == list(esperado.values())
        if origen == "xlsx" and destino == "json":
            assert list(obtenido) == list(esperado)

    return verificar


def _ver_imagen(destino: str, ancho: int | None = None) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == 1
        formato, (w, h), rgb = _imagen(s.archivos[0][1])
        _, (w0, h0), original = _imagen(s.entrada)
        assert formato == _FORMATO_PILLOW[destino]
        if ancho is None:
            assert (w, h) == (w0, h0)
            diferencia = ImageStat.Stat(ImageChops.difference(original, rgb)).mean
            assert max(diferencia) < 6
        else:
            assert w == ancho
            assert abs(h - h0 * ancho / w0) <= 1

    return verificar


def _ver_imagen_a_pdf(paginas: int) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == 1
        lector = PdfReader(io.BytesIO(s.archivos[0][1]))
        assert len(lector.pages) == paginas
        _, tamano, _ = _imagen(s.entrada)
        primera = lector.pages[0]
        assert len(primera.images) >= 1
        imagen_pdf = primera.images[0].image
        assert imagen_pdf is not None
        assert imagen_pdf.size == tamano
        assert float(primera.mediabox.width) > 0

    return verificar


def _ver_audio(destino: str) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == 1
        datos = s.archivos[0][1]
        assert detectar_medio(datos) == destino
        if destino == "wav":
            with wave.open(io.BytesIO(datos)) as onda:
                assert onda.getnchannels() >= 1
                duracion = onda.getnframes() / onda.getframerate()
            assert abs(duracion - _DURACION_AUDIO_S) < 0.3
        else:
            assert len(datos) > 1000

    return verificar


def _ver_pdf_a_imagen(destino: str) -> Verificador:
    def verificar(s: Salida) -> None:
        paginas = PdfReader(io.BytesIO(s.entrada)).pages
        assert len(s.archivos) == len(paginas) >= 2
        base = Path(s.nombre).stem
        for numero, ((nombre, datos), pagina) in enumerate(
            zip(s.archivos, paginas, strict=True), start=1
        ):
            assert nombre == f"{base}-p{numero}.{destino}"
            formato, (ancho, alto), _ = _imagen(datos)
            assert formato == _FORMATO_PILLOW[destino]
            assert abs(ancho - float(pagina.mediabox.width) * _DPI_PRUEBA / 72) <= 2
            assert abs(alto - float(pagina.mediabox.height) * _DPI_PRUEBA / 72) <= 2

    return verificar


def _ver_pdf_a_docx(s: Salida) -> None:
    assert len(s.archivos) == 1
    documento = Document(io.BytesIO(s.archivos[0][1]))
    texto = "\n".join(p.text for p in documento.paragraphs)
    for frase in _FRASES_TEXT_PDF:
        assert frase in texto


def _ver_pdf_a_md(s: Salida) -> None:
    assert len(s.archivos) == 1
    texto = s.archivos[0][1].decode("utf-8")
    for frase in _FRASES_TEXT_PDF:
        assert frase in texto


def _ver_unir(s: Salida) -> None:
    assert len(s.archivos) == 1
    esperado = _paginas(s.entrada) + sum(_paginas(a) for a in s.adicionales)
    assert _paginas(s.archivos[0][1]) == esperado
    # Basta la primera página y la última del principal para probar el orden.
    assert _texto_pagina(s.archivos[0][1], 0) == _texto_pagina(s.entrada, 0)
    ultima = _paginas(s.entrada) - 1
    assert _texto_pagina(s.archivos[0][1], ultima) == _texto_pagina(s.entrada, ultima)


def _ver_dividir(grupos: list[list[int]]) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == len(grupos)
        for (_, datos), grupo in zip(s.archivos, grupos, strict=True):
            assert _paginas(datos) == len(grupo)
            assert _texto_pagina(datos, 0) == _texto_pagina(s.entrada, grupo[0])

    return verificar


def _ver_rotar(grados: int, seleccion: set[int] | None) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == 1
        original = PdfReader(io.BytesIO(s.entrada)).pages
        rotado = PdfReader(io.BytesIO(s.archivos[0][1])).pages
        assert len(rotado) == len(original)
        for indice, (antes, despues) in enumerate(zip(original, rotado, strict=True)):
            girada = seleccion is None or indice in seleccion
            assert despues.rotation == (antes.rotation + (grados if girada else 0)) % 360
        assert _texto_pagina(s.archivos[0][1], 0) == _texto_pagina(s.entrada, 0)

    return verificar


def _ver_docx_a_pdf(*frases: str) -> Verificador:
    def verificar(s: Salida) -> None:
        assert len(s.archivos) == 1
        texto = _texto_pdf(s.archivos[0][1])
        for frase in frases:
            assert frase in texto

    return verificar


# Una hoja por tabla del documento; los números llegan como números de Excel.
def _ver_docx_a_xlsx(s: Salida) -> None:
    tablas = Document(io.BytesIO(s.entrada)).tables
    libro = load_workbook(io.BytesIO(s.archivos[0][1]))
    assert len(s.archivos) == 1
    assert len(libro.worksheets) == len(tablas) >= 1
    for hoja, tabla in zip(libro.worksheets, tablas, strict=True):
        esperado = [[c.text for c in fila.cells] for fila in tabla.rows]
        obtenido = list(hoja.iter_rows(values_only=True))
        assert len(obtenido) == len(esperado)
        for fila_o, fila_e in zip(obtenido, esperado, strict=True):
            assert len(fila_o) == len(fila_e)
            for valor, texto in zip(fila_o, fila_e, strict=True):
                if isinstance(valor, int | float):
                    assert float(valor) == float(texto.replace(",", "."))
                else:
                    assert _norm(valor) == texto


# ---------------------------------------------------------------- matriz de paridad


def _construir_matriz() -> list[Caso]:
    casos: list[Caso] = []

    def agregar(
        origen: str,
        destino: str,
        entrada: str,
        verificar: Verificador,
        opciones: dict[str, Any] | None = None,
        adicionales: tuple[str, ...] = (),
        etiqueta: str = "",
    ) -> None:
        casos.append(
            Caso(origen, destino, entrada, verificar, opciones or {}, adicionales, etiqueta)
        )

    # PDF
    agregar(
        "pdf",
        "pdf",
        "text.pdf",
        _ver_unir,
        {"operacion": "unir"},
        ("scanned.pdf",),
        "pdf-unir",
    )
    agregar(
        "pdf",
        "pdf",
        "text.pdf",
        _ver_dividir([[0], [1], [2]]),
        {"operacion": "dividir"},
        etiqueta="pdf-dividir",
    )
    agregar(
        "pdf",
        "pdf",
        "text.pdf",
        _ver_dividir([[0, 1], [2]]),
        {"operacion": "dividir", "rangos": "1-2,3"},
        etiqueta="pdf-dividir-rangos",
    )
    agregar(
        "pdf",
        "pdf",
        "text.pdf",
        _ver_rotar(90, {0}),
        {"operacion": "rotar", "grados": 90, "paginas": "1"},
        etiqueta="pdf-rotar-pagina",
    )
    agregar(
        "pdf",
        "pdf",
        "text.pdf",
        _ver_rotar(270, None),
        {"operacion": "rotar", "grados": 270},
        etiqueta="pdf-rotar-todas",
    )
    agregar("pdf", "png", "text.pdf", _ver_pdf_a_imagen("png"), {"dpi": _DPI_PRUEBA})
    agregar("pdf", "jpg", "text.pdf", _ver_pdf_a_imagen("jpg"), {"dpi": _DPI_PRUEBA})
    agregar("pdf", "docx", "text.pdf", _ver_pdf_a_docx)
    agregar("pdf", "md", "text.pdf", _ver_pdf_a_md)
    # Word
    agregar("docx", "pdf", "sample.docx", _ver_docx_a_pdf("Documento de prueba", "Introducción"))
    agregar("docx", "pdf", "table.docx", _ver_docx_a_pdf("Producto", "Manzana", "1.50"))
    agregar("docx", "xlsx", "sample.docx", _ver_docx_a_xlsx)
    agregar("docx", "xlsx", "table.docx", _ver_docx_a_xlsx)
    # Planillas
    for entrada, origen, destinos in (
        ("sample.xlsx", "xlsx", ("csv", "json", "pdf")),
        ("multisheet.xlsx", "xlsx", ("csv", "json", "pdf")),
        ("sample.csv", "csv", ("xlsx", "json", "pdf")),
        ("sample.json", "json", ("xlsx", "csv")),
    ):
        for destino in destinos:
            agregar(origen, destino, entrada, _ver_planilla(origen, destino))
    # Imágenes: fixtures y entradas generadas (jpg y webp) hacia todos los destinos
    for entrada, origen in (
        ("sample.png", "png"),
        ("images.png", "png"),
        ("gen.jpg", "jpg"),
        ("gen.webp", "webp"),
    ):
        for destino in _IMAGENES:
            if destino == origen:
                agregar(origen, destino, entrada, _ver_imagen(destino, 200), {"ancho_maximo": 200})
            else:
                agregar(origen, destino, entrada, _ver_imagen(destino))
        agregar(origen, "pdf", entrada, _ver_imagen_a_pdf(1))
    agregar(
        "png",
        "pdf",
        "sample.png",
        _ver_imagen_a_pdf(2),
        adicionales=("images.png",),
        etiqueta="sample.png-pdf-adicional",
    )
    # Audio y video (se saltan sin ffmpeg)
    for destino in _AUDIOS:
        agregar("mp4", destino, "sample.mp4", _ver_audio(destino))
    for entrada, origen in (
        ("sample.mp3", "mp3"),
        ("gen.wav", "wav"),
        ("gen.ogg", "ogg"),
        ("gen.m4a", "m4a"),
    ):
        for destino in _AUDIOS:
            if destino != origen:
                agregar(origen, destino, entrada, _ver_audio(destino))
    return casos


CASOS = _construir_matriz()


def _claves_de_la_tabla() -> set[tuple[str, str, str | None]]:
    anotacion = get_args(OpcionesConversion.model_fields["operacion"].annotation)[0]
    operaciones: tuple[str, ...] = get_args(anotacion)
    claves: set[tuple[str, str, str | None]] = set()
    for conversion in TABLA:
        if (conversion.origen, conversion.destino) == ("pdf", "pdf"):
            claves.update(("pdf", "pdf", operacion) for operacion in operaciones)
        else:
            claves.add((conversion.origen, conversion.destino, None))
    return claves


# Los tipos llegan como texto desde el resultado de la herramienta; aquí se afinan al literal.
def _conversion(origen: str, destino: str) -> Conversion:
    return buscar_conversion(cast("TipoOrigen", origen), destino)


def _destinos(origen: str) -> list[str]:
    return destinos_para(cast("TipoOrigen", origen))


def _requiere_ffmpeg(caso: Caso) -> bool:
    return _conversion(caso.origen, caso.destino).requiere_ffmpeg


_PARAMETROS_MATRIZ = [
    pytest.param(
        caso,
        id=caso.id,
        marks=[pytest.mark.skipif(_SIN_FFMPEG, reason="ffmpeg no está instalado")]
        if _requiere_ffmpeg(caso)
        else [],
    )
    for caso in CASOS
]


def test_la_matriz_cubre_toda_la_tabla() -> None:
    cubiertas = {caso.clave for caso in CASOS}
    esperadas = _claves_de_la_tabla()
    assert not esperadas - cubiertas, (
        f"Conversiones sin caso de paridad: {sorted(esperadas - cubiertas, key=str)}"
    )
    assert not cubiertas - esperadas, (
        f"Casos que no están en la tabla: {sorted(cubiertas - esperadas, key=str)}"
    )
    identificadores = [caso.id for caso in CASOS]
    assert len(identificadores) == len(set(identificadores))


@pytest.mark.anyio
@pytest.mark.parametrize("caso", _PARAMETROS_MATRIZ)
async def test_paridad_de_punta_a_punta(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], caso: Caso
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        nombre, datos = await banco.entrada(caso.entrada)
        identificador = banco.subir(nombre, datos)
        adicionales = [await banco.entrada(clave) for clave in caso.adicionales]
        opciones = dict(caso.opciones)
        if adicionales:
            opciones["archivos_adicionales"] = [banco.subir(n, d) for n, d in adicionales]
        subidas = banco.subidas()
        resultado = await banco.convertir(identificador, caso.destino, opciones)
        archivos = banco.leer(resultado)
        # Los originales no cambian y la conversión no deja nada nuevo en uploads/.
        assert banco.subidas() == subidas
        conversion = _conversion(caso.origen, caso.destino)
        assert (resultado["origen"], resultado["destino"]) == (caso.origen, caso.destino)
        # El aviso aparece exactamente donde la tabla declara fidelidad parcial.
        assert (resultado["aviso"] is not None) == conversion.fidelidad_parcial
        if conversion.fidelidad_parcial:
            assert resultado["aviso"].startswith("Fidelidad parcial")
        assert archivos
        for nombre_salida, contenido in archivos:
            assert nombre_salida.startswith(Path(nombre).stem)
            assert nombre_salida.endswith(f".{caso.destino}")
            assert detectar_origen(contenido, nombre_salida) == caso.destino
        caso.verificar(Salida(nombre, datos, archivos, [d for _, d in adicionales]))


# ---------------------------------------------------------------- reglas de la app web


@pytest.mark.anyio
@pytest.mark.parametrize("destino", ["docx", "md"])
async def test_pdf_escaneado_se_rechaza_pero_a_png_funciona(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], destino: str
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("scanned.pdf", fixture_bytes("scanned.pdf"))
        mensaje = await banco.esperar_error(identificador, destino, fragmentos=("escaneado",))
        assert "OCR" in mensaje
        resultado = await banco.convertir(identificador, "png", {"dpi": _DPI_PRUEBA})
        archivos = banco.leer(resultado)
        assert len(archivos) == _paginas(fixture_bytes("scanned.pdf"))
        for _, contenido in archivos:
            formato, (ancho, alto), _ = _imagen(contenido)
            assert formato == "PNG"
            assert ancho > 0
            assert alto > 0


def _opciones_pdf(operacion: str | None, extra: str | None) -> dict[str, Any]:
    opciones: dict[str, Any] = {}
    if operacion == "rotar":
        opciones = {"operacion": "rotar", "grados": 90}
    elif operacion is not None:
        opciones = {"operacion": operacion}
    if extra is not None:
        opciones["archivos_adicionales"] = [extra]
    return opciones


_DESTINOS_PDF = [
    ("docx", None),
    ("md", None),
    ("png", None),
    ("jpg", None),
    ("pdf", "dividir"),
    ("pdf", "rotar"),
    ("pdf", "unir"),
]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("fixture", "fragmento"),
    [("protected.pdf", "contraseña"), ("corrupt.pdf", "No se pudo abrir el PDF")],
)
@pytest.mark.parametrize(("destino", "operacion"), _DESTINOS_PDF)
async def test_pdf_protegido_o_corrupto_falla_en_cualquier_destino(
    tmp_path: Path,
    fixture_bytes: Callable[[str], bytes],
    fixture: str,
    fragmento: str,
    destino: str,
    operacion: str | None,
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir(fixture, fixture_bytes(fixture))
        extra = banco.subir("text.pdf", fixture_bytes("text.pdf")) if operacion == "unir" else None
        await banco.esperar_error(
            identificador, destino, _opciones_pdf(operacion, extra), fragmentos=(fragmento,)
        )


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("fixture", "fragmento"),
    [("protected.pdf", "contraseña"), ("corrupt.pdf", "No se pudo abrir")],
)
async def test_pdf_adicional_protegido_o_corrupto_falla_al_unir(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], fixture: str, fragmento: str
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        principal = banco.subir("text.pdf", fixture_bytes("text.pdf"))
        extra = banco.subir(fixture, fixture_bytes(fixture))
        await banco.esperar_error(
            principal, "pdf", _opciones_pdf("unir", extra), fragmentos=(fragmento,)
        )


@pytest.mark.anyio
async def test_docx_sin_tablas_no_se_convierte_a_xlsx(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("notables.docx", fixture_bytes("notables.docx"))
        await banco.esperar_error(identificador, "xlsx", fragmentos=("no tiene tablas",))


@pytest.mark.anyio
@pytest.mark.skipif(_SIN_FFMPEG, reason="ffmpeg no está instalado")
@pytest.mark.parametrize("destino", ["mp3", "wav", "ogg", "m4a"])
async def test_video_sin_audio_se_rechaza(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], destino: str
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("silent.mp4", fixture_bytes("silent.mp4"))
        await banco.esperar_error(identificador, destino, fragmentos=("no tiene audio",))


@pytest.mark.anyio
@pytest.mark.parametrize("destino", ["png", "jpg", "webp"])
async def test_webp_animado_se_rechaza(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], destino: str
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("animated.webp", fixture_bytes("animated.webp"))
        await banco.esperar_error(identificador, destino, fragmentos=("animado",))


@pytest.mark.anyio
async def test_png_con_transparencia_a_jpg_queda_sobre_fondo_blanco(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    imagen = Image.new("RGBA", (64, 64), (255, 0, 0, 0))
    imagen.paste(Image.new("RGBA", (32, 64), (0, 0, 255, 255)), (0, 0))
    buffer = io.BytesIO()
    imagen.save(buffer, format="PNG")
    async with _banco(tmp_path, fixture_bytes) as banco:
        archivos = await banco.convertir_bytes("alfa.png", buffer.getvalue(), "jpg")
    formato, _, rgb = _imagen(archivos[0][1])
    assert formato == "JPEG"
    transparente = rgb.getpixel((56, 32))
    opaco = rgb.getpixel((8, 32))
    assert isinstance(transparente, tuple)
    assert isinstance(opaco, tuple)
    assert min(transparente) >= 250  # el rojo transparente no se cuela: queda blanco
    assert opaco[2] > 200
    assert opaco[0] < 60


@pytest.mark.anyio
@pytest.mark.parametrize("destino", ["xlsx", "csv"])
@pytest.mark.parametrize(
    "contenido",
    [
        b'{"a": {"b": 1}}',
        b"[1, 2, 3]",
        b'[{"a": {"b": 1}}]',
        b'[{"a": 1}, 5]',
        b"[]",
        b'"texto"',
    ],
)
async def test_json_no_tabular_se_rechaza_explicando_la_forma_esperada(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], destino: str, contenido: bytes
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("datos.json", contenido)
        mensaje = await banco.esperar_error(
            identificador, destino, fragmentos=("no es tabular", "array de objetos")
        )
    assert "[{" in mensaje  # incluye un ejemplo de la forma esperada


# ---------------------------------------------------------------- seguridad y robustez


@pytest.mark.anyio
async def test_png_con_extension_pdf_se_trata_como_png(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("informe.pdf", fixture_bytes("sample.png"))
        listado = await banco.listar(identificador)
        assert listado["tipo"] == "png"
        destinos = [d["destino"] for o in listado["conversiones"] for d in o["destinos"]]
        assert destinos == _destinos("png")
        assert "docx" not in destinos
        await banco.esperar_error(identificador, "docx", fragmentos=("png a «docx»",))
        archivos = banco.leer(await banco.convertir(identificador, "jpg"))
        assert archivos[0][0] == "informe.jpg"
        assert _imagen(archivos[0][1])[0] == "JPEG"
        # También es un PNG real al pedir PDF: sale un PDF de una página con la imagen.
        pdf = banco.leer(await banco.convertir(identificador, "pdf"))
        assert detectar_origen(pdf[0][1], pdf[0][0]) == "pdf"
        assert _paginas(pdf[0][1]) == 1


@pytest.mark.anyio
async def test_pdf_con_extension_csv_se_trata_como_pdf(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("datos.csv", fixture_bytes("text.pdf"))
        listado = await banco.listar(identificador)
        assert listado["tipo"] == "pdf"
        await banco.esperar_error(identificador, "xlsx", fragmentos=("pdf a «xlsx»",))
        await banco.esperar_error(identificador, "json", fragmentos=("pdf a «json»",))
        archivos = banco.leer(await banco.convertir(identificador, "jpg", {"dpi": _DPI_PRUEBA}))
        assert [nombre for nombre, _ in archivos] == [f"datos-p{n}.jpg" for n in (1, 2, 3)]
        assert all(_imagen(datos)[0] == "JPEG" for _, datos in archivos)


@pytest.mark.anyio
async def test_docx_con_extension_xlsx_se_trata_como_docx(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("hoja.xlsx", fixture_bytes("sample.docx"))
        listado = await banco.listar(identificador)
        assert listado["tipo"] == "docx"
        await banco.esperar_error(identificador, "csv", fragmentos=("docx a «csv»",))


@pytest.mark.anyio
async def test_texto_con_extension_pdf_no_se_reconoce(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("falso.pdf", b"a,b\n1,2\n")
        await banco.esperar_error(identificador, "png", fragmentos=("No se reconoce",))


@pytest.mark.anyio
async def test_nombre_hostil_queda_saneado_dentro_de_outputs(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("../../etc/passwd.png", fixture_bytes("sample.png"))
        resultado = await banco.convertir(identificador, "jpg")
        assert [a["nombre"] for a in resultado["archivos"]] == ["passwd.jpg"]
        carpeta = (tmp_path / "trabajo" / "outputs").resolve()
        for archivo in resultado["archivos"]:
            assert banco.almacen.obtener(archivo["id"]).ruta.resolve().is_relative_to(carpeta)
    assert not (tmp_path / "etc").exists()
    assert not (tmp_path.parent / "etc").exists()


@pytest.mark.anyio
async def test_nombre_de_hoja_hostil_no_escapa_de_outputs(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    libro = Workbook()
    libro.active.title = "A..B <x>&ñ"
    libro.active.append(["col", "valor"])
    libro.active.append(["x", 1])
    libro.create_sheet("....").append(["y"])
    buffer = io.BytesIO()
    libro.save(buffer)
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir("libro.xlsx", buffer.getvalue())
        resultado = await banco.convertir(identificador, "csv")
        assert len(resultado["archivos"]) == 2
        carpeta = (tmp_path / "trabajo" / "outputs").resolve()
        for archivo, (nombre, _) in zip(resultado["archivos"], banco.leer(resultado), strict=True):
            assert "/" not in nombre
            assert "\\" not in nombre
            assert banco.almacen.obtener(archivo["id"]).ruta.resolve().is_relative_to(carpeta)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("nombre", "contenido"),
    [
        ("datos.csv", b"=CMD(),+SUM(1)\n@A1,-2+3\n=1+1,texto\n"),
        ("datos.json", b'[{"=CMD()": "=1+1", "b": "+cmd", "c": "@SUM(A1)"}]'),
    ],
)
async def test_inyeccion_de_formulas_queda_como_texto(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], nombre: str, contenido: bytes
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        archivos = await banco.convertir_bytes(nombre, contenido, "xlsx")
    libro = load_workbook(io.BytesIO(archivos[0][1]))
    celdas = [c for fila in libro.active.iter_rows() for c in fila]
    sospechosas = [c for c in celdas if isinstance(c.value, str) and c.value[:1] in "=+-@"]
    assert sospechosas  # la entrada con fórmula sigue estando, pero como texto
    for celda in sospechosas:
        assert celda.data_type == "s"
    assert all(c.data_type != "f" for c in celdas)
    assert not any(h.cell(row=1, column=1).data_type == "f" for h in libro.worksheets)


_SECRETO = "SECRETO-12345"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("nombre", "contenido", "destino"),
    [
        ("datos.json", f'{{"clave": {_SECRETO}'.encode(), "xlsx"),
        ("datos.json", f'{{"{_SECRETO}": {{"{_SECRETO}": 1}}}}'.encode(), "xlsx"),
        ("foto.png", b"\x89PNG\r\n\x1a\n" + _SECRETO.encode() * 3, "jpg"),
        ("doc.pdf", f"%PDF-1.4\n{_SECRETO}\n%%EOF\n".encode(), "png"),
        ("doc.pdf", f"%PDF-1.4\n{_SECRETO}\n%%EOF\n".encode(), "docx"),
        ("libro.xlsx", b"PK\x03\x04" + _SECRETO.encode() * 4, "csv"),
        ("texto.docx", b"PK\x03\x04" + _SECRETO.encode() * 4, "pdf"),
        ("audio.mp3", b"ID3" + _SECRETO.encode() * 8, "wav"),
    ],
)
async def test_los_errores_no_filtran_el_contenido_del_documento(
    tmp_path: Path,
    fixture_bytes: Callable[[str], bytes],
    nombre: str,
    contenido: bytes,
    destino: str,
) -> None:
    if nombre.endswith(".mp3") and _SIN_FFMPEG:
        pytest.skip("ffmpeg no está instalado")
    async with _banco(tmp_path, fixture_bytes) as banco:
        identificador = banco.subir(nombre, contenido)
        await banco.esperar_error(identificador, destino, secretos=(_SECRETO,))


# ---------------------------------------------------------------- ida y vuelta


@pytest.mark.anyio
async def test_xlsx_a_csv_y_de_vuelta_a_xlsx_conserva_los_datos(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    original = load_workbook(io.BytesIO(fixture_bytes("sample.xlsx")))
    async with _banco(tmp_path, fixture_bytes) as banco:
        csvs = await banco.convertir_bytes("sample.xlsx", fixture_bytes("sample.xlsx"), "csv")
        assert len(csvs) == len(original.worksheets) >= 2
        for (nombre, datos), hoja in zip(csvs, original.worksheets, strict=True):
            vuelta = await banco.convertir_bytes(nombre, datos, "xlsx")
            recuperada = load_workbook(io.BytesIO(vuelta[0][1])).worksheets[0]
            assert list(recuperada.values) == list(hoja.values)


@pytest.mark.anyio
async def test_csv_a_json_y_de_vuelta_a_csv_conserva_los_datos(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        jsons = await banco.convertir_bytes("sample.csv", fixture_bytes("sample.csv"), "json")
        registros = json.loads(jsons[0][1])
        assert isinstance(registros[0]["id"], int)  # los números salen como números
        vuelta = await banco.convertir_bytes(jsons[0][0], jsons[0][1], "csv")
    assert _tabla_csv(vuelta[0][1]) == _tabla_csv(fixture_bytes("sample.csv"))


@pytest.mark.anyio
async def test_tipos_de_celda_se_conservan_entre_planillas(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        xlsx = await banco.convertir_bytes("sample.csv", fixture_bytes("sample.csv"), "xlsx")
        json_ = await banco.convertir_bytes("sample.xlsx", fixture_bytes("sample.xlsx"), "json")
    hoja = load_workbook(io.BytesIO(xlsx[0][1])).worksheets[0]
    assert [c.data_type for c in hoja[2]] == ["n", "s", "n", "s"]
    libros = json.loads(json_[0][1])["Libros"]
    assert all(isinstance(fila["Paginas"], int) for fila in libros)
    assert all(isinstance(fila["ISBN"], str) for fila in libros)


# ---------------------------------------------------------------- listar vs convertir

_ARCHIVOS_LISTAR = [
    "pequeno.pdf",
    "scanned.pdf",
    "protected.pdf",
    "corrupt.pdf",
    "sample.docx",
    "table.docx",
    "notables.docx",
    "sample.xlsx",
    "multisheet.xlsx",
    "sample.csv",
    "sample.json",
    "sample.md",
    "sample.png",
    "images.png",
    "animated.webp",
    "sample.mp3",
    "sample.mp4",
    "silent.mp4",
]


# Opciones mínimas y rápidas para que el destino listado se pueda pedir sin más datos.
def _opciones_minimas(destino: str, tipo: str) -> dict[str, Any]:
    if tipo == "pdf" and destino == "pdf":
        return {"operacion": "dividir"}
    if tipo == "pdf" and destino in ("png", "jpg"):
        return {"dpi": _DPI_PRUEBA, "paginas": "1"}
    return {}


@pytest.mark.anyio
@pytest.mark.parametrize("fixture", _ARCHIVOS_LISTAR)
async def test_listar_es_coherente_con_convertir(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes], fixture: str
) -> None:
    async with _banco(tmp_path, fixture_bytes) as banco:
        nombre, datos = await banco.entrada(fixture)
        identificador = banco.subir(nombre, datos)
        listado = await banco.listar(identificador)
        tipo = listado["tipo"]
        destinos = [d for origen in listado["conversiones"] for d in origen["destinos"]]
        assert [d["destino"] for d in destinos] == _destinos(tipo)
        assert listado["ffmpeg_disponible"] is (not _SIN_FFMPEG)
        for entrada in destinos:
            conversion = _conversion(tipo, entrada["destino"])
            assert entrada["fidelidad_parcial"] is conversion.fidelidad_parcial
            assert entrada["opciones"] == list(conversion.opciones)
            assert entrada["disponible"] is (not (conversion.requiere_ffmpeg and _SIN_FFMPEG))
            if not entrada["disponible"]:
                continue
            opciones = _opciones_minimas(entrada["destino"], tipo)
            try:
                resultado = await banco.convertir(identificador, entrada["destino"], opciones)
            except ToolError as error:
                mensaje = str(error)
                assert "No se puede convertir un archivo" not in mensaje
                assert any(f in mensaje for f in _ERRORES_DE_CONTENIDO), mensaje
            else:
                assert resultado["destino"] == entrada["destino"]
                banco.leer(resultado)
        await _verificar_no_listados(banco, identificador, tipo)


# Todo destino que no se lista se rechaza con el error de destino no soportado.
async def _verificar_no_listados(banco: Banco, identificador: str, tipo: str) -> None:
    validos = _destinos(tipo)
    for destino in (d for d in _DESTINOS_POSIBLES if d not in validos):
        if tipo == "md":
            await banco.esperar_error(
                identificador, destino, fragmentos=("Markdown no se convierte",)
            )
            continue
        mensaje = await banco.esperar_error(
            identificador, destino, fragmentos=(f"No se puede convertir un archivo {tipo}",)
        )
        assert ", ".join(validos) in mensaje
