"""Parser de Markdown a bloques del modelo, tolerante a Markdown mal formado."""

from markdown_it import MarkdownIt
from markdown_it.token import Token
from pydantic import ValidationError

from convertitodo_mcp.blocks.modelo import (
    PROFUNDIDAD_MAXIMA_LISTA,
    Bloque,
    Cita,
    Codigo,
    Documento,
    Imagen,
    ItemLista,
    Lista,
    Parrafo,
    SaltoPagina,
    Tabla,
    Titulo,
    Tramo,
)

_TIPOS_TEXTO = ("text", "text_special", "html_inline")


# Parser que deja la validación de esquemas de enlace al modelo de bloques.
class _ParserPermisivo(MarkdownIt):
    # Acepta cualquier destino para que el modelo decida qué esquemas se admiten.
    def validateLink(self, url: str) -> bool:
        return True


# Crea el parser CommonMark con tablas y sin interpretar HTML crudo.
def _crear_parser() -> MarkdownIt:
    return _ParserPermisivo("commonmark", {"html": False}).enable("table")


# Devuelve el índice posterior al bloque que abre el token en la posición i.
def _fin(tokens: list[Token], i: int) -> int:
    if tokens[i].nesting != 1:
        return i + 1
    nivel = tokens[i].level
    j = i + 1
    while j < len(tokens) and not (tokens[j].level == nivel and tokens[j].nesting == -1):
        j += 1
    return j + 1


# Une tramos contiguos que comparten el mismo formato.
def _compactar(tramos: list[Tramo]) -> list[Tramo]:
    salida: list[Tramo] = []
    for t in tramos:
        if not t.texto:
            continue
        if salida:
            a = salida[-1]
            if (a.negrita, a.italica, a.codigo, a.enlace) == (
                t.negrita,
                t.italica,
                t.codigo,
                t.enlace,
            ):
                salida[-1] = a.model_copy(update={"texto": a.texto + t.texto})
                continue
        salida.append(t)
    return salida


# Devuelve el enlace si el modelo lo acepta y None si el esquema no está permitido.
def _enlace_valido(destino: str) -> str | None:
    try:
        return Tramo(texto="x", enlace=destino).enlace
    except ValidationError:
        return None


# Convierte los hijos de un token inline en tramos con formato.
def _tramos_inline(inline: Token) -> list[Tramo]:
    tramos: list[Tramo] = []
    negrita = 0
    italica = 0
    enlaces: list[str | None] = []

    # Agrega un tramo con el formato vigente.
    def agregar(texto: str, codigo: bool = False) -> None:
        enlace = next((e for e in reversed(enlaces) if e is not None), None)
        tramos.append(
            Tramo(
                texto=texto,
                negrita=negrita > 0,
                italica=italica > 0,
                codigo=codigo,
                enlace=enlace,
            )
        )

    for hijo in inline.children or []:
        tipo = hijo.type
        if tipo in _TIPOS_TEXTO:
            agregar(hijo.content)
        elif tipo == "softbreak":
            agregar(" ")
        elif tipo == "hardbreak":
            agregar("\n")
        elif tipo == "code_inline":
            agregar(hijo.content, codigo=True)
        elif tipo == "strong_open":
            negrita += 1
        elif tipo == "strong_close":
            negrita = max(0, negrita - 1)
        elif tipo == "em_open":
            italica += 1
        elif tipo == "em_close":
            italica = max(0, italica - 1)
        elif tipo == "link_open":
            enlaces.append(_enlace_valido(str(hijo.attrs.get("href", ""))))
        elif tipo == "link_close":
            if enlaces:
                enlaces.pop()
        elif tipo == "image":
            agregar(hijo.content)
    return _compactar(tramos)


# Texto plano de todos los inline y bloques de código dentro del rango de tokens.
def _texto_plano_rango(tokens: list[Token], ini: int, fin: int) -> str:
    partes: list[str] = []
    for t in tokens[ini:fin]:
        if t.type == "inline":
            partes.append("".join(x.texto for x in _tramos_inline(t)))
        elif t.type in ("fence", "code_block"):
            partes.append(t.content.removesuffix("\n"))
    return "\n".join(p for p in partes if p)


# Une el contenido de un contenedor (item o cita) en un solo texto con formato.
def _tramos_contenedor(
    tokens: list[Token], ini: int, fin: int, con_listas: bool = False
) -> list[Tramo]:
    grupos: list[list[Tramo]] = []
    i = ini
    while i < fin:
        t = tokens[i]
        sig = _fin(tokens, i)
        if t.type == "paragraph_open":
            grupos.append(_tramos_inline(tokens[i + 1]))
        elif not con_listas and t.type in ("bullet_list_open", "ordered_list_open"):
            pass
        else:
            texto = _texto_plano_rango(tokens, i, sig)
            if texto:
                grupos.append([Tramo(texto=texto)])
        i = sig
    salida: list[Tramo] = []
    for n, grupo in enumerate(grupos):
        if n:
            salida.append(Tramo(texto="\n"))
        salida.extend(grupo)
    return _compactar(salida)


# Convierte una lista (ordenada o no) a su modelo, aplanando lo que excede la profundidad.
def _lista(tokens: list[Token], i: int, nivel: int) -> tuple[Lista, int]:
    fin = _fin(tokens, i)
    items: list[ItemLista] = []
    j = i + 1
    while j < fin - 1:
        if tokens[j].type != "list_item_open":
            j += 1
            continue
        fin_item = _fin(tokens, j)
        texto = _tramos_contenedor(tokens, j + 1, fin_item - 1)
        sublista: Lista | None = None
        k = j + 1
        while k < fin_item - 1:
            sig = _fin(tokens, k)
            if tokens[k].type in ("bullet_list_open", "ordered_list_open"):
                hija, _ = _lista(tokens, k, nivel + 1)
                if sublista is None:
                    sublista = hija
                else:
                    sublista.items.extend(hija.items)
            k = sig
        item = ItemLista(texto=texto)
        if sublista is not None and nivel >= PROFUNDIDAD_MAXIMA_LISTA:
            items.append(item)
            items.extend(sublista.items)
        else:
            item.sublista = sublista
            items.append(item)
        j = fin_item
    ordenada = tokens[i].type == "ordered_list_open"
    return Lista(ordenada=ordenada, items=items), fin


# Convierte las celdas de una fila en listas de tramos.
def _celdas(tokens: list[Token], ini: int, fin: int) -> list[list[Tramo]]:
    return [_tramos_inline(t) for t in tokens[ini:fin] if t.type == "inline"]


# Ajusta una fila al número de columnas esperado.
def _ajustar(fila: list[list[Tramo]], columnas: int) -> list[list[Tramo]]:
    return (fila + [[] for _ in range(columnas)])[:columnas]


# Convierte una tabla GFM a su modelo, normalizando filas desparejas.
def _tabla(tokens: list[Token], i: int) -> tuple[Tabla, int]:
    fin = _fin(tokens, i)
    encabezado: list[list[Tramo]] | None = None
    filas: list[list[list[Tramo]]] = []
    j = i + 1
    while j < fin - 1:
        if tokens[j].type == "tr_open":
            fin_fila = _fin(tokens, j)
            celdas = _celdas(tokens, j + 1, fin_fila - 1)
            if encabezado is None and tokens[j + 1].type == "th_open":
                encabezado = celdas
            else:
                filas.append(celdas)
            j = fin_fila
        else:
            j += 1
    columnas = (
        len(encabezado) if encabezado is not None else max((len(f) for f in filas), default=0)
    )
    filas = [_ajustar(f, columnas) for f in filas]
    return Tabla(encabezado=encabezado, filas=filas), fin


# Genera un bloque Imagen si el párrafo es una imagen sola con un id de archivo válido.
def _imagen_sola(inline: Token) -> Imagen | None:
    hijos = inline.children or []
    if len(hijos) != 1 or hijos[0].type != "image":
        return None
    try:
        return Imagen(
            archivo=str(hijos[0].attrs.get("src", "")), texto_alternativo=hijos[0].content
        )
    except ValidationError:
        return None


# Convierte los tokens en el rango dado a bloques del modelo.
def _bloques(tokens: list[Token], ini: int, fin: int) -> list[Bloque]:
    salida: list[Bloque] = []
    i = ini
    while i < fin:
        t = tokens[i]
        sig = _fin(tokens, i)
        if t.type == "heading_open":
            nivel = min(6, max(1, int(t.tag[1:])))
            salida.append(Titulo(nivel=nivel, texto=_tramos_inline(tokens[i + 1])))
        elif t.type == "paragraph_open":
            inline = tokens[i + 1]
            imagen = _imagen_sola(inline)
            if imagen is not None:
                salida.append(imagen)
            else:
                salida.append(Parrafo(texto=_tramos_inline(inline)))
        elif t.type in ("bullet_list_open", "ordered_list_open"):
            lista, sig = _lista(tokens, i, 1)
            salida.append(lista)
        elif t.type == "table_open":
            tabla, sig = _tabla(tokens, i)
            salida.append(tabla)
        elif t.type in ("fence", "code_block"):
            lenguaje = t.info.split()[0] if t.type == "fence" and t.info.split() else None
            salida.append(Codigo(texto=t.content.removesuffix("\n"), lenguaje=lenguaje))
        elif t.type == "blockquote_open":
            salida.append(Cita(texto=_tramos_contenedor(tokens, i + 1, sig - 1, con_listas=True)))
        elif t.type == "hr":
            salida.append(SaltoPagina())
        i = sig
    return salida


# Convierte un texto Markdown en una lista de bloques; nunca lanza por Markdown mal formado.
def markdown_a_bloques(texto: str) -> list[Bloque]:
    if not texto.strip():
        return []
    try:
        tokens = _crear_parser().parse(texto)
        return _bloques(tokens, 0, len(tokens))
    except (ValidationError, ValueError, IndexError, KeyError, AttributeError):
        return [Parrafo(texto=[Tramo(texto=texto.strip())])]


# Convierte un texto Markdown en un documento completo.
def markdown_a_documento(texto: str) -> Documento:
    return Documento(bloques=markdown_a_bloques(texto))
