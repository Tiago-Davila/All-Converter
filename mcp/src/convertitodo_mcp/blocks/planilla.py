"""Esquema de planilla que escribe el modelo de lenguaje para crear un XLSX."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Límites propios del formato XLSX.
MAX_COLUMNAS_EXCEL = 16384
MAX_FILAS_EXCEL = 1048576
_CARACTERES_PROHIBIDOS_HOJA = frozenset(":\\/?*[]")

TipoColumna = Literal["texto", "numero", "entero", "moneda", "porcentaje", "fecha"]


# Fórmula explícita: es la única forma de que una celda calcule algo.
class Formula(BaseModel):
    model_config = ConfigDict(extra="forbid")

    formula: str = Field(
        min_length=1,
        max_length=8192,
        description=(
            "Fórmula de Excel con funciones en inglés y coma entre argumentos, por ejemplo "
            "'=SUM(B2:B10)' o \"='Otra hoja'!A1*2\"."
        ),
    )


# Valor literal de una celda; el tipo de la columna decide cómo se guarda.
ValorSimple = bool | int | float | str | None
# Valor de celda tal como lo envía el modelo: literal o fórmula.
Valor = ValorSimple | Formula


# Columna de una hoja: nombre del encabezado, tipo de dato, formato y ancho.
class Columna(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=1, max_length=255, description="Texto del encabezado.")
    tipo: TipoColumna = Field(
        default="texto",
        description=(
            "Tipo de dato: texto, numero, entero, moneda, porcentaje (0.15 = 15 %) o fecha "
            "(AAAA-MM-DD o DD/MM/AAAA)."
        ),
    )
    formato: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Formato numérico de Excel opcional, por ejemplo '#,##0.000'.",
    )
    ancho: float | None = Field(
        default=None, gt=0, le=255, description="Ancho fijo en caracteres (opcional)."
    )

    # Rechaza caracteres de control que corromperían el XML del formato.
    @field_validator("formato")
    @classmethod
    def _validar_formato(cls, valor: str | None) -> str | None:
        if valor is not None and any(ord(c) < 32 for c in valor):
            raise ValueError("El formato no puede tener caracteres de control.")
        return valor


# Hoja de cálculo con columnas tipadas y filas de valores.
class Hoja(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(
        min_length=1, max_length=31, description="Nombre de la hoja (hasta 31 caracteres)."
    )
    columnas: list[Columna] = Field(
        min_length=1, max_length=MAX_COLUMNAS_EXCEL, description="Columnas, en orden."
    )
    filas: list[list[Valor]] = Field(
        default_factory=list,
        max_length=MAX_FILAS_EXCEL - 2,
        description="Filas de datos; cada fila tiene un valor por columna (null deja vacía).",
    )

    # Aplica las reglas de Excel para nombres de hoja.
    @field_validator("nombre")
    @classmethod
    def _validar_nombre(cls, valor: str) -> str:
        if any(c in _CARACTERES_PROHIBIDOS_HOJA or ord(c) < 32 for c in valor):
            raise ValueError(
                "El nombre de la hoja no puede tener los caracteres : \\ / ? * [ ] ni "
                "caracteres de control."
            )
        if valor.startswith("'") or valor.endswith("'"):
            raise ValueError("El nombre de la hoja no puede empezar ni terminar con apóstrofo.")
        if valor.strip().lower() == "history":
            raise ValueError("'History' es un nombre reservado por Excel; usá otro.")
        return valor

    # Exige nombres de columna únicos y filas con la misma cantidad de valores que columnas.
    @model_validator(mode="after")
    def _validar_filas(self) -> "Hoja":
        nombres = [columna.nombre.strip().lower() for columna in self.columnas]
        if len(nombres) != len(set(nombres)):
            raise ValueError(
                f"La hoja '{self.nombre}' tiene nombres de columna repetidos; usá nombres únicos."
            )
        esperadas = len(self.columnas)
        for numero, fila in enumerate(self.filas, start=1):
            if len(fila) != esperadas:
                raise ValueError(
                    f"La fila {numero} de la hoja '{self.nombre}' tiene {len(fila)} valores y "
                    f"la hoja define {esperadas} columnas. Usá null para dejar celdas vacías."
                )
        return self


# Libro completo: una o más hojas con nombres únicos.
class Planilla(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hojas: list[Hoja] = Field(min_length=1, max_length=255, description="Hojas del libro.")

    # Excel compara los nombres de hoja sin distinguir mayúsculas.
    @model_validator(mode="after")
    def _validar_hojas(self) -> "Planilla":
        nombres = [hoja.nombre.lower() for hoja in self.hojas]
        if len(nombres) != len(set(nombres)):
            raise ValueError("Hay hojas con el mismo nombre; cada hoja necesita un nombre único.")
        return self

    # Total de filas de datos de todas las hojas, para aplicar el límite configurado.
    def total_filas(self) -> int:
        return sum(len(hoja.filas) for hoja in self.hojas)
