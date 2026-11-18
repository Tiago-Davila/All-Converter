"""Paginación virtual sin mezclar unidades físicas del documento."""

from __future__ import annotations

from dataclasses import dataclass

from convertitodo_mcp.errores import ErrorArgumento, ErrorLimiteExcedido
from convertitodo_mcp.read.modelos import DocumentoLeido


@dataclass(frozen=True)
class PaginaLectura:
    numero: int
    total_paginas: int
    origen: int
    nombre_hoja: str | None
    contenido: str
    siguiente: int | None


def paginar_documento(
    documento: DocumentoLeido,
    pagina: int = 1,
    max_caracteres: int = 8000,
    *,
    max_bytes: int,
) -> PaginaLectura:
    """Devuelve una página virtual, conservando incluso las unidades vacías."""
    if not 1 <= max_caracteres <= 20000:
        raise ErrorArgumento(
            "El límite de caracteres debe estar entre 1 y 20000.",
            "indicá un valor dentro de ese rango.",
        )
    if pagina < 1:
        raise ErrorArgumento("La página debe ser mayor que cero.", "indicá una página válida.")

    total_bytes = 0
    total_paginas = 0
    seleccion: tuple[int, int, str] | None = None
    for origen, contenido in enumerate(documento.paginas, 1):
        total_bytes += len(contenido.encode("utf-8"))
        if total_bytes > max_bytes:
            raise ErrorLimiteExcedido(
                "El texto extraído supera el tamaño permitido.",
                "usá un documento más pequeño.",
            )
        cantidad = max(1, (len(contenido) + max_caracteres - 1) // max_caracteres)
        if total_paginas < pagina <= total_paginas + cantidad:
            inicio = (pagina - total_paginas - 1) * max_caracteres
            seleccion = (origen, inicio, contenido)
        total_paginas += cantidad

    if seleccion is None:
        raise ErrorArgumento(
            "La página solicitada no existe.",
            "indicá una página dentro del documento.",
        )
    origen, inicio, contenido = seleccion
    nombre_hoja = documento.hojas[origen - 1] if origen <= len(documento.hojas) else None
    return PaginaLectura(
        numero=pagina,
        total_paginas=total_paginas,
        origen=origen,
        nombre_hoja=nombre_hoja,
        contenido=contenido[inicio : inicio + max_caracteres],
        siguiente=pagina + 1 if pagina < total_paginas else None,
    )
