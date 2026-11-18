"""Detección de origen, tabla de conversiones y validación de opciones."""

from collections.abc import Callable
from pathlib import Path

import pytest

from convertitodo_mcp.convert.registro import (
    TABLA,
    TIPOS_ACEPTADOS,
    OpcionesConversion,
    TipoOrigen,
    buscar_conversion,
    cargar_origen,
    convertir_datos,
    destinos_para,
    detectar_origen,
)
from convertitodo_mcp.errores import (
    ErrorArgumento,
    ErrorFormatoNoSoportado,
    ErrorLimiteExcedido,
)
from convertitodo_mcp.server.config import Configuracion
from convertitodo_mcp.storage import Almacen

TIPOS_FIXTURES: list[tuple[str, TipoOrigen]] = [
    ("animated.webp", "webp"),
    ("corrupt.pdf", "pdf"),
    ("images.png", "png"),
    ("multisheet.xlsx", "xlsx"),
    ("notables.docx", "docx"),
    ("protected.pdf", "pdf"),
    ("sample.csv", "csv"),
    ("sample.docx", "docx"),
    ("sample.json", "json"),
    ("sample.md", "md"),
    ("sample.mp3", "mp3"),
    ("sample.mp4", "mp4"),
    ("sample.png", "png"),
    ("sample.xlsx", "xlsx"),
    ("scanned.pdf", "pdf"),
    ("silent.mp4", "mp4"),
    ("table.docx", "docx"),
    ("text.pdf", "pdf"),
]

DESTINOS: dict[str, list[str]] = {
    "pdf": ["pdf", "png", "jpg", "docx", "md"],
    "docx": ["pdf", "xlsx"],
    "xlsx": ["csv", "json", "pdf"],
    "csv": ["xlsx", "json", "pdf"],
    "json": ["xlsx", "csv"],
    "md": [],
    "png": ["jpg", "webp", "png", "pdf"],
    "jpg": ["png", "webp", "jpg", "pdf"],
    "webp": ["png", "jpg", "webp", "pdf"],
    "mp3": ["wav", "ogg", "m4a"],
    "wav": ["mp3", "ogg", "m4a"],
    "ogg": ["mp3", "wav", "m4a"],
    "m4a": ["mp3", "wav", "ogg"],
    "mp4": ["mp3", "wav", "ogg", "m4a"],
}


@pytest.mark.parametrize(("nombre", "esperado"), TIPOS_FIXTURES)
def test_detecta_todos_los_fixtures(
    fixture_bytes: Callable[[str], bytes], nombre: str, esperado: TipoOrigen
) -> None:
    assert detectar_origen(fixture_bytes(nombre), nombre) == esperado


def test_firma_gana_sobre_extension(fixture_bytes: Callable[[str], bytes]) -> None:
    assert detectar_origen(fixture_bytes("sample.png"), "x.pdf") == "png"
    assert detectar_origen(fixture_bytes("text.pdf"), "x.csv") == "pdf"
    assert detectar_origen(fixture_bytes("sample.docx"), "x.xlsx") == "docx"


def test_texto_con_extension_de_binario_falla() -> None:
    with pytest.raises(ErrorFormatoNoSoportado) as error:
        detectar_origen(b"hola, esto es texto", "x.png")
    assert "pdf, docx" in str(error.value)


def test_texto_por_extension_en_mayusculas() -> None:
    assert detectar_origen(b"a,b\n1,2\n", "DATOS.CSV") == "csv"
    assert detectar_origen(b"[1, 2]", "x.json") == "json"
    assert detectar_origen(b"# Hola", "nota.markdown") == "md"


@pytest.mark.parametrize("contenido", [b"{no es json", b"", b"\x00\x01\x02"])
def test_json_invalido_o_vacio_falla(contenido: bytes) -> None:
    with pytest.raises((ErrorArgumento, ErrorFormatoNoSoportado)):
        detectar_origen(contenido, "x.json")


def test_vacio_falla_con_cualquier_nombre() -> None:
    with pytest.raises(ErrorArgumento):
        detectar_origen(b"", "x.pdf")


def test_html_y_desconocidos_no_se_aceptan() -> None:
    for datos, nombre in ((b"<html><body>x</body></html>", "x.html"), (b"texto", "x.txt")):
        with pytest.raises(ErrorFormatoNoSoportado) as error:
            detectar_origen(datos, nombre)
        assert "estos tipos" in str(error.value)


def test_pptx_no_se_puede_convertir() -> None:
    import io
    import zipfile

    memoria = io.BytesIO()
    with zipfile.ZipFile(memoria, "w") as paquete:
        paquete.writestr("[Content_Types].xml", "<Types/>")
        paquete.writestr("_rels/.rels", "<Relationships/>")
        paquete.writestr("ppt/presentation.xml", "<p/>")
    with pytest.raises(ErrorFormatoNoSoportado):
        detectar_origen(memoria.getvalue(), "x.pptx")


@pytest.mark.parametrize("origen", TIPOS_ACEPTADOS)
def test_destinos_por_origen(origen: TipoOrigen) -> None:
    assert destinos_para(origen) == DESTINOS[origen]


def test_tabla_sin_duplicados_y_con_despacho() -> None:
    pares = [(c.origen, c.destino) for c in TABLA]
    assert len(pares) == len(set(pares))
    assert set(DESTINOS) == set(TIPOS_ACEPTADOS)
    for conversion in TABLA:
        assert callable(conversion.ejecutar)
        assert buscar_conversion(conversion.origen, conversion.destino) is conversion
        assert conversion.descripcion
        assert conversion.requiere_ffmpeg == (
            conversion.origen in ("mp3", "wav", "ogg", "m4a", "mp4")
        )
        assert conversion.fidelidad_parcial == bool(conversion.nota_fidelidad)
    for origen, destinos in DESTINOS.items():
        for destino in destinos:
            assert (origen, destino) in pares
    parciales = {(c.origen, c.destino) for c in TABLA if c.fidelidad_parcial}
    assert {("pdf", "docx"), ("pdf", "md"), ("docx", "pdf"), ("docx", "xlsx")} == parciales


def test_markdown_como_origen_sugiere_crear_pdf_y_docx() -> None:
    with pytest.raises(ErrorFormatoNoSoportado) as error:
        buscar_conversion("md", "pdf")
    assert "crear_pdf" in str(error.value)
    assert "crear_docx" in str(error.value)


def test_destino_inexistente_lista_los_validos() -> None:
    with pytest.raises(ErrorFormatoNoSoportado) as error:
        buscar_conversion("xlsx", "docx")
    assert "csv, json, pdf" in str(error.value)


def _convertir(
    tmp_path: Path,
    datos: bytes,
    origen: TipoOrigen,
    destino: str,
    opciones: OpcionesConversion,
    adicionales: list[tuple[TipoOrigen, bytes]] | None = None,
) -> list[str]:
    config = Configuracion(carpeta_trabajo=tmp_path)
    salidas = convertir_datos(
        "Mi archivo.bin",
        origen,
        datos,
        destino,
        opciones,
        adicionales=adicionales or [],
        almacen=Almacen(tmp_path),
        config=config,
    )
    return [s.nombre for s in salidas]


def test_opcion_que_no_aplica_nombra_las_validas(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    with pytest.raises(ErrorArgumento) as error:
        _convertir(
            tmp_path,
            fixture_bytes("sample.png"),
            "png",
            "jpg",
            OpcionesConversion(dpi=100),
        )
    mensaje = str(error.value)
    assert "«dpi»" in mensaje
    assert "calidad, ancho_maximo" in mensaje


def test_conversion_sin_opciones_lo_dice(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    with pytest.raises(ErrorArgumento) as error:
        _convertir(
            tmp_path, fixture_bytes("sample.docx"), "docx", "pdf", OpcionesConversion(calidad=5)
        )
    assert "no acepta opciones" in str(error.value)


def test_operacion_fuera_de_pdf_a_pdf_falla(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    with pytest.raises(ErrorArgumento):
        _convertir(
            tmp_path,
            fixture_bytes("text.pdf"),
            "pdf",
            "png",
            OpcionesConversion(operacion="unir"),
        )


def test_archivos_adicionales_donde_no_corresponde(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    casos: list[tuple[TipoOrigen, str, str]] = [
        ("pdf", "text.pdf", "png"),
        ("docx", "sample.docx", "pdf"),
        ("csv", "sample.csv", "xlsx"),
    ]
    for origen, nombre, destino in casos:
        with pytest.raises(ErrorArgumento) as error:
            _convertir(
                tmp_path,
                fixture_bytes(nombre),
                origen,
                destino,
                OpcionesConversion(archivos_adicionales=["abc"]),
            )
        assert "archivos_adicionales" in str(error.value)


def test_pdf_a_pdf_sin_operacion_lista_las_operaciones(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    with pytest.raises(ErrorArgumento) as error:
        _convertir(tmp_path, fixture_bytes("text.pdf"), "pdf", "pdf", OpcionesConversion())
    assert "unir, dividir, rotar" in str(error.value)


def test_opciones_por_operacion(tmp_path: Path, fixture_bytes: Callable[[str], bytes]) -> None:
    pdf = fixture_bytes("text.pdf")
    with pytest.raises(ErrorArgumento, match="grados"):
        _convertir(tmp_path, pdf, "pdf", "pdf", OpcionesConversion(operacion="rotar"))
    with pytest.raises(ErrorArgumento, match="archivos_adicionales"):
        _convertir(tmp_path, pdf, "pdf", "pdf", OpcionesConversion(operacion="unir"))
    with pytest.raises(ErrorArgumento, match="«rangos»"):
        _convertir(
            tmp_path,
            pdf,
            "pdf",
            "pdf",
            OpcionesConversion(operacion="rotar", grados=90, rangos="1"),
        )


def test_nombres_de_salida_salen_del_nombre_original(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    pdf = fixture_bytes("text.pdf")
    assert _convertir(tmp_path, pdf, "pdf", "docx", OpcionesConversion()) == ["Mi archivo.docx"]
    unido = _convertir(
        tmp_path,
        pdf,
        "pdf",
        "pdf",
        OpcionesConversion(operacion="unir", archivos_adicionales=["x"]),
        [("pdf", pdf)],
    )
    assert unido == ["Mi archivo-unido.pdf"]
    giradas = _convertir(
        tmp_path, pdf, "pdf", "pdf", OpcionesConversion(operacion="rotar", grados=180)
    )
    assert giradas == ["Mi archivo-rotado.pdf"]
    paginas = _convertir(tmp_path, pdf, "pdf", "pdf", OpcionesConversion(operacion="dividir"))
    assert paginas[0] == "Mi archivo-p1.pdf"


def test_adicionales_de_otro_tipo_se_rechazan(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    pdf = fixture_bytes("text.pdf")
    with pytest.raises(ErrorArgumento, match="número 1"):
        _convertir(
            tmp_path,
            pdf,
            "pdf",
            "pdf",
            OpcionesConversion(operacion="unir", archivos_adicionales=["x"]),
            [("png", fixture_bytes("sample.png"))],
        )


def test_cargar_origen_detecta_y_respeta_el_tope(
    tmp_path: Path, fixture_bytes: Callable[[str], bytes]
) -> None:
    almacen = Almacen(tmp_path)
    guardado = almacen.guardar_subida("../raro nombre.pdf", fixture_bytes("text.pdf"))
    config = Configuracion(carpeta_trabajo=tmp_path)
    nombre, tipo, datos = cargar_origen(guardado.id, almacen, config)
    assert (nombre, tipo) == ("raro nombre.pdf", "pdf")
    assert datos == fixture_bytes("text.pdf")
    chico = Configuracion(carpeta_trabajo=tmp_path, max_mb=1)
    grande = almacen.guardar_subida("grande.csv", b"a,b\n" + b"1,2\n" * 400_000)
    with pytest.raises(ErrorLimiteExcedido):
        cargar_origen(grande.id, almacen, chico)
