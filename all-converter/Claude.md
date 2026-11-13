# ConvertiTodo

El repositorio contiene dos proyectos independientes:

- `all-converter/`: convertidor web 100% client-side con librerías JS/WASM. Los archivos
  del usuario nunca salen del navegador.
- `mcp/`: servidor MCP Python para modelos locales, ejecutado en la máquina del usuario
  o en su red local. No envía documentos a servicios externos.

Las rutas de la app web indicadas abajo son relativas a `all-converter/`. Las rutas
que comienzan con `mcp/` o `.github/` son relativas a la raíz del repositorio.

## Stack de la app web

- React 19 + Vite + TypeScript estricto + Tailwind CSS v4
- Vitest (tests), deploy estático en Vercel
- Sin backend. Sin base de datos. Sin excepciones.

## Reglas duras de la app web (no negociables)

1. Ningún archivo del usuario se envía a ningún servidor, API ni servicio externo.
   Si una solución requiere red para procesar el archivo, está descartada.
2. Este proyecto se gestiona con Spec-Driven Development (GitHub Spec Kit).
   La fuente de verdad está en specs/001-convertitodo/. No implementar nada que
   no esté trazado a una tarea de tasks.md. Una tarea, un diff, un commit.
3. Toda conversión implementa la interfaz Converter (src/converters/types.ts) y se
   registra en src/converters/registry.ts. La UI solo conoce el registry.
4. Los conversores NO importan React ni tocan el DOM. Lógica y UI separadas siempre.
5. Toda conversión pesada corre en un Web Worker. El main thread nunca se bloquea.
   ArrayBuffers se pasan como transferables, no copiados.
6. Librerías pesadas (ffmpeg.wasm, pdfjs-dist, SheetJS, mammoth, docx) se cargan con
   dynamic import() solo cuando se necesitan. Bundle inicial < 200KB gzip.
7. Tipo de archivo por magic bytes (librería file-type) + extensión como fallback.
   Nunca confiar solo en la extensión.
8. TypeScript estricto, prohibido `any`. Ningún conversor se mergea sin test de
   Vitest con fixture real en tests/fixtures/.
9. Cada conversor define maxSizeMB. La UI rechaza archivos que lo excedan ANTES
   de intentar convertir, con mensaje claro.

## Trampas conocidas de este proyecto

- ffmpeg.wasm multithread necesita SharedArrayBuffer → vercel.json ya define headers
  COOP/COEP. No quitarlos. Si no hay SharedArrayBuffer, degradar a single-thread.
- COEP rompe recursos externos: fonts self-hosteadas, nada de CDNs en runtime.
- pdfjs-dist: configurar workerSrc con asset local del bundle, nunca CDN.
- SheetJS se instala desde https://cdn.sheetjs.com (la versión de npm está vieja).
- DOCX→PDF y PDF→DOCX tienen fidelidad parcial por diseño. No intentar "arreglarlo"
  con soluciones que violen la regla 1. La UI ya comunica la limitación.
- MP3→MP4 necesita un video track: imagen del usuario o waveform generado.

## Comandos de la app web (desde `all-converter/`)

- npm run dev — desarrollo
- npm run build — build de producción (verificar tamaño de chunks)
- npm run test — Vitest
- npm run preview — probar el build (necesario para verificar COOP/COEP local)

## Estructura de la app web

- src/converters/ — un módulo por conversión + registry + types
- src/workers/ — workers de conversión con canal tipado
- src/components/ — Dropzone, FileQueue, ConversionCard, ProgressBar, ResultDownload
- src/lib/ — detección de tipo, ZIP, límites, utilidades
- tests/fixtures/ — archivos reales chicos para tests
- specs/001-convertitodo/ — spec, plan, data-model, tasks (fuente de verdad, NO tocar
  durante implementación)

## Servidor MCP (`mcp/`)

- Python 3.12 con uv; FastMCP y pydantic. Dependencias directas fijadas a versiones
  exactas en `mcp/pyproject.toml`, con resolución en `mcp/uv.lock`.
- La hoja de ruta actual está en los issues #104–#113: cada cambio debe indicar issue
  y tarea (por ejemplo, #104 / T001). Sus tareas son independientes de las de la app web.
  Mientras no exista una spec propia del MCP, esos issues definen su alcance.
- La app web sigue siendo autónoma y sin backend: no conectar sus conversiones al MCP.
  El MCP procesa documentos localmente; HTTP permite transferirlos entre el cliente
  y el servidor de la red local, nunca a APIs o servicios de terceros.
- HTTP exige token Bearer en cualquier host. Mantener autenticación, límites de entrada,
  bloqueo de path traversal y symlinks, ids opacos y borrado por TTL.
- No registrar contenido de documentos ni tokens. Errores claros en español, sin
  stack traces ni rutas internas en las respuestas.
- Mantener separación entre servidor, bloques, renderizado, lectura, conversión y
  almacenamiento. Las reglas de React, registry y Web Workers corresponden a la app web.
- Ruff, mypy estricto y pytest son las puertas de calidad del MCP. Reutilizar los fixtures
  reales de `all-converter/tests/fixtures/` mediante `mcp/tests/conftest.py`.
- Consultar `mcp/README.md` para variables de entorno, instalación y transportes.

### Comandos del MCP (desde `mcp/`)

- `uv sync --locked` — instalar las dependencias del lockfile.
- `uv run convertitodo-mcp` — arrancar por stdio.
- `uv run convertitodo-mcp --transporte http` — arrancar por HTTP con
  `CONVERTITODO_MCP_TOKEN` configurado.
- `uv run ruff check .` — lint.
- `uv run ruff format --check .` — formato.
- `uv run mypy` — tipos estrictos.
- `uv run pytest` — tests.
- `.github/workflows/mcp.yml` ejecuta lint, formato, tipos y tests en CI.

### Estructura del MCP

- `mcp/src/convertitodo_mcp/server/` — servidor, configuración, CLI y transporte HTTP.
- `mcp/src/convertitodo_mcp/blocks/` — modelo de bloques y parser Markdown.
- `mcp/src/convertitodo_mcp/render/` — renderizadores y fuentes locales.
- `mcp/src/convertitodo_mcp/read/` — lectura de documentos.
- `mcp/src/convertitodo_mcp/convert/` — conversiones.
- `mcp/src/convertitodo_mcp/storage/` — archivos locales, rutas seguras y limpieza.
- `mcp/tests/` — pruebas del servidor y de la lógica de documentos.

## Estilo de trabajo

- Commits chicos y descriptivos en español (conventional commits: feat, fix, test, chore, docs), no agregues coautoria al commit.
- Ante ambigüedad entre el pedido y la spec, gana la spec; avisar la discrepancia.
- No agregar dependencias nuevas sin justificarlas primero.
- Crear ramas desde `develop` y dirigir los PRs a `develop`, siguiendo el patrón existente
  `feat/mcp-tNNN-descripcion` para tareas del MCP. Usar `fix/` o `docs/` según el cambio.
- Una tarea, un diff y un commit. En el PR indicar problema, cambio, issue/tarea y
  validación realizada; mencionar límites relevantes. No declarar checks no ejecutados.
- Comentarios de código breves en español: explicar decisiones que el código no muestre.
- Con varios agentes, asignar archivos distintos y centralizar commits e integración en
  el orquestador. Los agentes no ejecutan suites, builds ni instalaciones en paralelo.
  Ejecutar las pruebas una vez al integrar; repetir solo lo necesario si hay fallos o
  cambios posteriores. Informar brevemente el estado de cada agente.
