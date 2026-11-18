"""Modelo de bloques del documento que escribe el modelo de lenguaje."""

from collections.abc import Sequence
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

PROFUNDIDAD_MAXIMA_LISTA = 6
ESQUEMAS_ENLACE_PERMITIDOS = frozenset({"http", "https", "mailto"})


# Fragmento de texto con formato en línea.
class Tramo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    texto: str = Field(description="Texto del fragmento.")
    negrita: bool = Field(default=False, description="Poner el fragmento en negrita.")
    italica: bool = Field(default=False, description="Poner el fragmento en itálica.")
    codigo: bool = Field(default=False, description="Mostrar el fragmento como código en línea.")
    enlace: str | None = Field(
        default=None, description="URL del enlace (solo http, https o mailto)."
    )

    # Valida que el enlace use un esquema permitido.
    @field_validator("enlace")
    @classmethod
    def _validar_enlace(cls, valor: str | None) -> str | None:
        if valor is None or not valor.strip():
            return None
        limpio = valor.strip()
        esquema = urlsplit(limpio).scheme.lower()
        if esquema not in ESQUEMAS_ENLACE_PERMITIDOS:
            raise ValueError(
                f"El enlace '{limpio}' no es válido: solo se admiten enlaces que empiecen con "
                "http://, https:// o mailto:. Corregí la URL o quitá el campo 'enlace'."
            )
        return limpio


# Convierte un str suelto o una lista mezclada de str y objetos en una lista de tramos.
def _a_tramos(valor: object) -> object:
    if isinstance(valor, str):
        return [{"texto": valor}]
    if isinstance(valor, list):
        return [{"texto": e} if isinstance(e, str) else e for e in valor]
    return valor


Tramos = Annotated[
    list[Tramo],
    BeforeValidator(_a_tramos),
    Field(description="Texto: un string, o una lista de tramos con formato."),
]


# Convierte un str suelto en un item de lista con ese texto.
def _a_item(valor: object) -> object:
    if isinstance(valor, str):
        return {"texto": valor}
    return valor


# Elemento de una lista, con una sublista opcional.
class ItemLista(BaseModel):
    model_config = ConfigDict(extra="forbid")

    texto: Tramos
    sublista: "Lista | None" = Field(default=None, description="Lista anidada bajo este item.")


Item = Annotated[ItemLista, BeforeValidator(_a_item)]


# Lista ordenada o con viñetas, posiblemente anidada.
class Lista(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["lista"] = "lista"
    ordenada: bool = Field(default=False, description="True para lista numerada.")
    items: list[Item] = Field(description="Items de la lista (string u objeto con 'texto').")

    # Limita la profundidad de anidación de la lista.
    @model_validator(mode="after")
    def _validar_profundidad(self) -> "Lista":
        if self.profundidad() > PROFUNDIDAD_MAXIMA_LISTA:
            raise ValueError(
                f"La lista tiene más de {PROFUNDIDAD_MAXIMA_LISTA} niveles de anidación. "
                "Reducí los niveles de 'sublista'."
            )
        return self

    # Cantidad de niveles de la lista, contando este.
    def profundidad(self) -> int:
        hijas = [i.sublista.profundidad() for i in self.items if i.sublista is not None]
        return 1 + max(hijas, default=0)


ItemLista.model_rebuild()


# Título o encabezado de sección.
class Titulo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["titulo"] = "titulo"
    nivel: int = Field(default=1, ge=1, le=6, description="Nivel del título, de 1 a 6.")
    texto: Tramos


# Párrafo de texto.
class Parrafo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["parrafo"] = "parrafo"
    texto: Tramos


# Tabla con encabezado opcional.
class Tabla(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["tabla"] = "tabla"
    encabezado: list[Tramos] | None = Field(
        default=None, description="Celdas del encabezado (strings o tramos)."
    )
    filas: list[list[Tramos]] = Field(
        description="Filas de la tabla; cada fila es una lista de celdas (strings o tramos)."
    )

    # Verifica que todas las filas tengan la misma cantidad de columnas.
    @model_validator(mode="after")
    def _validar_columnas(self) -> "Tabla":
        if self.encabezado is not None:
            esperadas = len(self.encabezado)
            origen = f"el encabezado ({esperadas})"
        elif self.filas:
            esperadas = len(self.filas[0])
            origen = f"la fila 1 ({esperadas})"
        else:
            return self
        for numero, fila in enumerate(self.filas, start=1):
            if len(fila) != esperadas:
                raise ValueError(
                    f"La fila {numero} de la tabla tiene {len(fila)} celdas pero {origen} "
                    "define otra cantidad. Todas las filas deben tener la misma cantidad "
                    "de columnas: agregá o quitá celdas."
                )
        return self


# Imagen ya subida al servidor, referida por su identificador.
class Imagen(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["imagen"] = "imagen"
    archivo: str = Field(description="Id de un archivo ya subido (no rutas ni data URIs).")
    ancho_mm: float | None = Field(
        default=None, gt=0, description="Ancho deseado en milímetros (opcional)."
    )
    texto_alternativo: str = Field(default="", description="Descripción breve de la imagen.")

    # Rechaza rutas y data URIs: solo se admite un id opaco.
    @field_validator("archivo")
    @classmethod
    def _validar_archivo(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio or any(c in limpio for c in "/\\:") or ".." in limpio:
            raise ValueError(
                "'archivo' debe ser el id de un archivo ya subido al servidor, sin rutas "
                "ni data URIs. Usá el id que devolvió la subida."
            )
        return limpio


# Bloque de código con texto literal.
class Codigo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["codigo"] = "codigo"
    texto: str = Field(description="Código literal, sin formato.")
    lenguaje: str | None = Field(default=None, description="Lenguaje del código (opcional).")


# Cita textual.
class Cita(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["cita"] = "cita"
    texto: Tramos


# Salto a una página nueva.
class SaltoPagina(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tipo: Literal["salto_pagina"] = "salto_pagina"


Bloque = Annotated[
    Titulo | Parrafo | Lista | Tabla | Imagen | Codigo | Cita | SaltoPagina,
    Field(discriminator="tipo"),
]


# Documento completo: una secuencia de bloques.
class Documento(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bloques: list[Bloque] = Field(description="Bloques del documento, en orden.")


# Concatena el texto de los tramos sin formato.
def texto_plano(tramos: Sequence[Tramo]) -> str:
    return "".join(t.texto for t in tramos)
