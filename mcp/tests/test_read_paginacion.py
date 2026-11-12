"""La paginación conserva el texto y sus unidades físicas."""

import pytest

from convertitodo_mcp.errores import ErrorArgumento, ErrorLimiteExcedido
from convertitodo_mcp.read.modelos import DocumentoLeido
from convertitodo_mcp.read.paginacion import paginar_documento


def test_paginas_unicode_sin_perdida_y_con_origen() -> None:
    documento = DocumentoLeido(
        tipo="xlsx", paginas=["á🙂bcde", "", "fin"], hojas=["Uno", "Dos", "Tres"]
    )
    paginas = [paginar_documento(documento, n, 2, max_bytes=100) for n in range(1, 6)]
    assert [p.contenido for p in paginas] == ["á🙂", "bc", "de", "", "fin"[:2]]
    assert [p.origen for p in paginas] == [1, 1, 1, 2, 3]
    assert paginas[3].nombre_hoja == "Dos"
    ultima = paginar_documento(documento, 6, 2, max_bytes=100)
    assert ultima.contenido == "n"
    assert ultima.total_paginas == 6
    assert ultima.siguiente is None
    assert "".join(p.contenido for p in [*paginas, ultima]) == "á🙂bcdefin"


def test_limites_y_pagina_inexistente() -> None:
    documento = DocumentoLeido(tipo="pdf", paginas=["á"], hojas=[])
    for numero, longitud in [(0, 1), (2, 1), (1, 0), (1, 20001)]:
        with pytest.raises(ErrorArgumento):
            paginar_documento(documento, numero, longitud, max_bytes=10)
    with pytest.raises(ErrorLimiteExcedido):
        paginar_documento(documento, max_bytes=1)
