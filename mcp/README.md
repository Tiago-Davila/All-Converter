# ConvertiTodo MCP

Servidor MCP en Python para que un modelo local (llama-server, OpenCode) pueda **crear PDF, Word y
Excel** a partir de Markdown o bloques estructurados, **leer documentos** y **convertir entre
formatos**. Corre en la máquina del usuario o en su red local.

> **Estado actual: solo setup (fase 1).** Hoy existe el andamiaje del proyecto (dependencias,
> lint, tipos y CI). **El servidor todavía no existe**: llega en la fase 2 (#105), junto con la
> configuración por variables de entorno. Hoja de ruta completa: issues #104 a #113.

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
| Ejecución | fastmcp, pydantic, reportlab, pypdf, python-docx, openpyxl, markitdown, pypdfium2, pillow, markdown-it-py |
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
| `CONVERTITODO_MCP_TOKEN` | Token Bearer que deben enviar los clientes HTTP. Mínimo 16 caracteres; vacío equivale a no definirlo. | Sin valor. Obligatorio para HTTP; el servidor no arranca en `0.0.0.0` sin token. |
| `CONVERTITODO_MCP_WORKDIR` | Carpeta de trabajo, con `uploads/` (entradas) y `outputs/` (resultados). Se expande `~`. | `$XDG_DATA_HOME/convertitodo-mcp` o `~/.local/share/convertitodo-mcp` |
| `CONVERTITODO_MCP_TTL_MINUTOS` | Minutos tras los cuales se borran automáticamente los archivos viejos (mínimo 1). | `60` |
| `CONVERTITODO_MCP_MAX_MB` | Tamaño máximo de un archivo de entrada, en MB (mínimo 1). | `25` |
| `CONVERTITODO_MCP_TIMEOUT_S` | Timeout, en segundos, por herramienta (mínimo 1). | `60` |
| `CONVERTITODO_MCP_MAX_BLOQUES` | Máximo de bloques por documento (mínimo 1). | `2000` |
| `CONVERTITODO_MCP_MAX_FILAS` | Máximo de filas por hoja (mínimo 1). | `10000` |

---|---|---|
| `CONVERTITODO_MCP_HOST` | Dirección en la que escucha el transporte HTTP. | `127.0.0.1` |
| `CONVERTITODO_MCP_PORT` | Puerto del transporte HTTP. | `8765` |
| `CONVERTITODO_MCP_TOKEN` | Token Bearer que deben enviar los clientes HTTP. | Sin valor. Obligatorio para HTTP; el servidor no arranca en `0.0.0.0` sin token. |
| `CONVERTITODO_MCP_WORKDIR` | Carpeta de trabajo, con `uploads/` (entradas) y `outputs/` (resultados). | A definir en la fase 2 |
| `CONVERTITODO_MCP_TTL_MINUTOS` | Minutos tras los cuales se borran automáticamente los archivos viejos. | A definir en la fase 2 |
| `CONVERTITODO_MCP_MAX_MB` | Tamaño máximo de un archivo de entrada. | A definir en la fase 2 |
| `CONVERTITODO_MCP_TIMEOUT_S` | Timeout, en segundos, por herramienta. | A definir en la fase 2 |

---

## Cómo arrancarlo

**Hoy no hay nada que arrancar.** El punto de entrada se agrega en la fase 2 (#105). La idea es
que el servidor ofrezca dos transportes:

- **HTTP**, para usarlo desde otra máquina de la red local. Exige el token Bearer
  (`CONVERTITODO_MCP_TOKEN`) y por defecto escucha solo en `127.0.0.1`.
- **stdio**, para clientes que lo lanzan como proceso hijo en la misma máquina, como OpenCode.

Cuando exista el comando de arranque, se documentará acá con un ejemplo de configuración para
cada cliente.

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
