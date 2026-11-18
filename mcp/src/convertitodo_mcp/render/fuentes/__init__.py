"""Fuentes Noto Sans incluidas (licencia OFL) y su registro en reportlab."""

from pathlib import Path

from reportlab.lib.fonts import addMapping
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

CARPETA_FUENTES: Path = Path(__file__).resolve().parent
FAMILIA: str = "NotoSans"
FAMILIA_MONO: str = "NotoSansMono"
NORMAL: str = "NotoSans"
NEGRITA: str = "NotoSans-Bold"
CURSIVA: str = "NotoSans-Italic"
NEGRITA_CURSIVA: str = "NotoSans-BoldItalic"
MONO: str = "NotoSansMono"

# Nombre registrado -> archivo TTF dentro de esta carpeta
ARCHIVOS: dict[str, str] = {
    NORMAL: "NotoSans-Regular.ttf",
    NEGRITA: "NotoSans-Bold.ttf",
    CURSIVA: "NotoSans-Italic.ttf",
    NEGRITA_CURSIVA: "NotoSans-BoldItalic.ttf",
    MONO: "NotoSansMono-Regular.ttf",
}


# Devuelve la ruta del TTF registrado con ese nombre
def ruta_fuente(nombre: str) -> Path:
    if nombre not in ARCHIVOS:
        validos = ", ".join(ARCHIVOS)
        raise KeyError(f"Fuente desconocida: {nombre!r}. Nombres válidos: {validos}.")
    return CARPETA_FUENTES / ARCHIVOS[nombre]


# Registra las fuentes y la familia en reportlab (idempotente)
def registrar_fuentes() -> None:
    for nombre in ARCHIVOS:
        ruta = ruta_fuente(nombre)
        if not ruta.is_file():
            raise FileNotFoundError(
                f"Falta el archivo de fuente {ruta.name} en la instalación del servidor. "
                "Reinstalá el paquete para restaurar las fuentes incluidas."
            )
    registradas = set(pdfmetrics.getRegisteredFontNames())
    for nombre in ARCHIVOS:
        if nombre not in registradas:
            pdfmetrics.registerFont(TTFont(nombre, str(ruta_fuente(nombre))))
    pdfmetrics.registerFontFamily(
        FAMILIA, normal=NORMAL, bold=NEGRITA, italic=CURSIVA, boldItalic=NEGRITA_CURSIVA
    )
    addMapping(FAMILIA_MONO, 0, 0, MONO)
    addMapping(FAMILIA_MONO, 1, 0, MONO)
    addMapping(FAMILIA_MONO, 0, 1, MONO)
    addMapping(FAMILIA_MONO, 1, 1, MONO)
