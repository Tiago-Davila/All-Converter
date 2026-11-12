# ConvertiTodo MCP

Servidor MCP en Python para que un modelo local (llama-server, OpenCode) pueda **crear PDF, Word y
Excel** a partir de Markdown o bloques estructurados, **leer documentos** y **convertir entre
formatos**. Corre en la máquina del usuario o en su red local.

> **Estado actual: fase 3.** El servidor ofrece `ping` y `crear_pdf` por stdio y HTTP.
> Por HTTP exige un token Bearer y permite subir y descargar archivos (`POST /files`,
> `GET /files/{id}`). Las demás conversiones y la lectura están pendientes.
> Hoja de ruta completa: issues #104 a #113.

---

## Requisitos e instalación

- [uv](https://docs.astral.sh/uv/). Instala Python 3.12 por su cuenta si no está disponible.

```bash
cd mcp
uv sync
```

Las dependencias están fijadas en `pyproject.toml` y `uv.lock`.

| Uso | Paquetes |
|---|---|
| Ejecución | anyio, fastmcp, pydantic, reportlab, pypdf, python-docx, openpyxl, markitdown, pypdfium2, pillow, markdown-it-py, python-multipart |
| Desarrollo | ruff, mypy (estricto), pytest |

---

## Variables de entorno

Todas son opcionales. Un valor inválido o una variable con el prefijo `CONVERTITODO_MCP_` que no
exista (por ejemplo un error de tipeo) hace que el servidor no arranque y explique cómo corregirlo.

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `CONVERTITODO_MCP_TRANSPORTE` | Transporte del servidor: `stdio` o `http`. | `stdio` |
| `CONVERTITODO_MCP_HOST` | Dirección en la que escucha el transporte HTTP. No puede estar vacía. | `127.0.0.1` |
| `CONVERTITODO_MCP_PORT` | Puerto del transporte HTTP, de 1 a 65535. | `8765` |
| `CONVERTITODO_MCP_TOKEN` | Token Bearer que deben enviar los clientes HTTP. Mínimo 16 caracteres; vacío equivale a no definirlo. | Sin valor. Obligatorio para HTTP en cualquier host: sin token el servidor no arranca. En stdio no se usa. |
| `CONVERTITODO_MCP_WORKDIR` | Carpeta de trabajo, con `uploads/` (entradas) y `outputs/` (resultados). Se expande `~`. | `$XDG_DATA_HOME/convertitodo-mcp` o `~/.local/share/convertitodo-mcp` |
| `CONVERTITODO_MCP_TTL_MINUTOS` | Minutos tras los cuales se borran automáticamente los archivos viejos (mínimo 1). | `60` |
| `CONVERTITODO_MCP_MAX_MB` | Tamaño máximo de un archivo de entrada, en MB (mínimo 1). | `25` |
| `CONVERTITODO_MCP_TIMEOUT_S` | Timeout, en segundos, por herramienta (mínimo 1). | `60` |
| `CONVERTITODO_MCP_MAX_BLOQUES` | Máximo de bloques por documento (mínimo 1). | `2000` |
| `CONVERTITODO_MCP_MAX_FILAS` | Máximo de filas por hoja (mínimo 1). | `10000` |

---

## Cómo arrancarlo

Desde `mcp/`, después de `uv sync`. Los argumentos `--transporte`, `--host` y `--puerto` pisan a
las variables de entorno; `--version` muestra la versión.

**stdio** (el cliente lo lanza como proceso hijo, por ejemplo OpenCode en la misma máquina). Es el
transporte por defecto y por stdout solo circula el protocolo:

```bash
uv run convertitodo-mcp
# equivalente: uv run python -m convertitodo_mcp
```

**HTTP** (red local). El token Bearer es obligatorio: genéralo, expórtalo y arranca.

```bash
export CONVERTITODO_MCP_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
uv run convertitodo-mcp --transporte http --host 127.0.0.1 --puerto 8765
```

Cada petición al endpoint `/mcp` debe llevar la cabecera `Authorization: Bearer <token>`; sin ella
o con un token distinto el servidor responde `401`. Sin `CONVERTITODO_MCP_TOKEN` el transporte HTTP
no arranca (sale con código 2 y explica cómo generarlo), sea cual sea el host. Si además el host es
`0.0.0.0` o `::`, nunca se expone a la red sin token. El transporte stdio no necesita token.

Ejemplo mínimo de configuración de un cliente MCP por stdio (en OpenCode, `opencode.json`):

```json
{
  "mcp": {
    "convertitodo": {
      "type": "local",
      "command": ["uv", "run", "--directory", "/ruta/a/All-Converter/mcp", "convertitodo-mcp"],
      "enabled": true
    }
  }
}
```

Si hay un error de configuración, el servidor lo explica en stderr y termina con código 2.

### Herramientas

| Herramienta | Qué hace |
|---|---|
| `ping` | Sin argumentos. Comprueba que el servidor responde y devuelve `estado` (`ok`), `servidor`, `version` y `hora` (ISO 8601, UTC). Es de solo lectura. |
| `crear_pdf` | Crea un PDF a partir de Markdown o bloques y devuelve `id`, `nombre`, `paginas` y `url`. |


### Crear un PDF

`crear_pdf` exige `titulo` y exactamente uno de `markdown` o `bloques`. Los bloques admiten
`título` (tipo `titulo`), párrafo, lista anidada, tabla, código, cita, salto de página e imagen
con el `id` de un archivo previamente subido. Las imágenes se validan y se ajustan a la página.
Las tablas largas repiten su encabezado. El diseño y la cobertura de caracteres dependen de las
fuentes incluidas; una celda que no cabe en una página debe dividirse.

Ejemplo de argumentos MCP:

```json
{
  "titulo": "Informe",
  "markdown": "# Informe\n\nTexto con **negrita**.",
  "opciones": {
    "tamano": "A4",
    "orientacion": "vertical",
    "margenes": {"superior": 25, "inferior": 25, "izquierdo": 25, "derecho": 25},
    "autor": "Autora",
    "numerar_paginas": true
  }
}
```

Las opciones admiten tamaño `A4` o `Carta`, orientación `vertical` u `horizontal`, márgenes en
milímetros, `titulo` y `autor` en los metadatos y `numerar_paginas`. Sin título de metadatos se
usa el argumento `titulo`; la numeración requiere margen inferior de al menos 10 mm. El resultado
contiene una URL relativa `/files/{id}`: solo es descargable por HTTP con el token. En stdio no se
habilita HTTP; el archivo queda en la carpeta `outputs/` del directorio de trabajo hasta su TTL.

---

## Subir y descargar archivos

Para que un cliente pase archivos al servidor y recupere los resultados, el transporte HTTP expone
dos endpoints propios, además de `/mcp`. **Solo existen con el transporte HTTP**: en stdio no hay
servidor web y no están disponibles. Ambos exigen `Authorization: Bearer <token>` y responden `401`
sin él. No son herramientas MCP: el `id` que devuelven es el que después se pasa a las herramientas.

**`POST /files`** guarda un archivo en `uploads/`. Admite dos formas:

```bash
# multipart/form-data: campo `file` (o `archivo`); el nombre sale del filename de la parte
curl -H "Authorization: Bearer $CONVERTITODO_MCP_TOKEN" \
  -F "file=@informe.pdf" http://127.0.0.1:8765/files

# cuerpo crudo: el nombre va en ?nombre= (o ?filename=); sin nombre se usa "archivo"
curl -H "Authorization: Bearer $CONVERTITODO_MCP_TOKEN" \
  --data-binary @informe.pdf -H "Content-Type: application/octet-stream" \
  "http://127.0.0.1:8765/files?nombre=informe.pdf"
```

Respuesta `201`:

```json
{"id": "Xk3...", "nombre": "informe.pdf", "tamano": 20480, "url": "/files/Xk3..."}
```

El nombre se sanea (sin rutas ni caracteres peligrosos) y el tamaño no puede superar
`CONVERTITODO_MCP_MAX_MB`: si `Content-Length` ya lo excede se rechaza sin leer el cuerpo y, si no,
se corta apenas lo recibido pasa el tope.

**`GET /files/{id}`** descarga un archivo de `uploads/` o `outputs/` como adjunto
(`Content-Disposition: attachment`, con el nombre en UTF-8 según RFC 5987, `Content-Type` según la
extensión y `X-Content-Type-Options: nosniff`):

```bash
curl -H "Authorization: Bearer $CONVERTITODO_MCP_TOKEN" \
  -OJ http://127.0.0.1:8765/files/<id>
```

**Errores.** Siempre JSON en español, `{"error": "<codigo>", "mensaje": "<qué falló y cómo corregirlo>"}`:

| Estado | `error` | Cuándo |
|---|---|---|
| `400` | `argumento_invalido` | Archivo vacío, id con formato inválido o multipart mal formado. |
| `401` | `no_autorizado` | Falta el token o es incorrecto. |
| `404` | `archivo_no_encontrado` | El id no existe (o ya venció su TTL). |
| `413` | `limite_excedido` | El archivo supera `CONVERTITODO_MCP_MAX_MB`. |
| `415` | `formato_no_soportado` | El multipart no trae un campo de archivo `file` o `archivo`. |
| `500` | `error` | Fallo interno; el mensaje no incluye detalles del servidor. |

---

## Límites

Para que una llamada no agote la máquina, el servidor rechaza antes de procesar. Todos los
topes se ajustan con variables de entorno (ver la tabla de arriba):

- **Tamaño de entrada**: archivos y textos (medidos en bytes UTF-8) por encima de
  `CONVERTITODO_MCP_MAX_MB`.
- **Bloques por documento**: `CONVERTITODO_MCP_MAX_BLOQUES`. Cuentan los items de lista (también
  los de sublistas) y las filas de tabla, no solo los bloques de primer nivel.
- **Filas**: `CONVERTITODO_MCP_MAX_FILAS` limita las filas de las tablas de un documento y las de
  cada hoja de una planilla.
- **Tiempo**: `CONVERTITODO_MCP_TIMEOUT_S` es el máximo de segundos por herramienta.

Al superar un tope, la herramienta devuelve un error en español que indica cuánto llegó, cuál es
el máximo y cómo corregirlo (achicar o dividir el documento, o subir la variable). Si vence el
tiempo, la llamada se cancela con un error de tiempo agotado.

## Borrado automático

Los archivos de `uploads/` y `outputs/` no se conservan para siempre: pasado el TTL desde su
última modificación, el servidor los borra solos. El TTL se ajusta con
`CONVERTITODO_MCP_TTL_MINUTOS` (60 minutos por defecto).

- **Cuándo se revisa**: al arrancar, y después cada cuarto del TTL, entre 30 segundos y 15 minutos
  (con el TTL por defecto, cada 15 minutos).
- **Qué se borra**: los archivos vencidos y también las carpetas de reserva abandonadas (vacías o
  con solo temporales) que superaron el TTL.
- **Qué no toca**: nada fuera de `uploads/` y `outputs/`, y no sigue enlaces simbólicos.

Si un id deja de existir, la herramienta lo informa y hay que subir o generar el archivo de nuevo.

---

## Desarrollo

Desde `mcp/`:

```bash
uv sync                      # instalar dependencias
uv run ruff check .          # lint
uv run ruff format --check . # formato
uv run mypy                  # tipos (estricto)
uv run pytest                # tests
```

Los tests reutilizan los fixtures reales de la app web (`all-converter/tests/fixtures/`), así que
el MCP y la app se prueban contra los mismos archivos. La CI corre estos mismos comandos en
`.github/workflows/mcp.yml`.

---

## Estructura

```
mcp/
├── pyproject.toml            Proyecto `convertitodo-mcp` (Python 3.12, uv)
├── uv.lock                   Dependencias en versiones fijas
├── src/convertitodo_mcp/
│   ├── server/               Servidor FastMCP, transportes y herramientas
│   ├── blocks/               Modelo de bloques de documento (pydantic)
│   ├── render/               Generación de PDF, Word y Excel
│   ├── read/                 Lectura de documentos
│   ├── convert/              Conversión entre formatos
│   └── storage/              Carpeta de trabajo, límites y borrado por TTL
└── tests/                    Tests de pytest
```

---

## Fuentes incluidas

El paquete trae las fuentes Noto Sans (normal, negrita, cursiva, negrita cursiva) y Noto Sans Mono
en `src/convertitodo_mcp/render/fuentes/`. Se incluyen para que los PDF muestren bien la ñ, las
tildes y el símbolo €, que las fuentes estándar de PDF no cubren. Son libres bajo la licencia SIL
Open Font License 1.1 (texto en `OFL.txt`, misma carpeta).

---

## Privacidad

Los archivos se procesan en la máquina del usuario o en su red local. El MCP no los envía a
servicios externos: no hay llamadas a APIs de terceros ni telemetría.
