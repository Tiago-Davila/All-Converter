# ConvertiTodo

Convertidor de archivos 100% client-side. Todo el procesamiento ocurre en el navegador
con librerías JS/WASM. Los archivos del usuario NUNCA salen de su máquina.

## Stack
- React 19 + Vite + TypeScript estricto + Tailwind CSS v4
- Vitest (tests), deploy estático en Vercel
- Sin backend. Sin base de datos. Sin excepciones.

## Reglas duras (no negociables)
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

## Comandos
- npm run dev — desarrollo
- npm run build — build de producción (verificar tamaño de chunks)
- npm run test — Vitest
- npm run preview — probar el build (necesario para verificar COOP/COEP local)

## Estructura
- src/converters/ — un módulo por conversión + registry + types
- src/workers/ — workers de conversión con canal tipado
- src/components/ — Dropzone, FileQueue, ConversionCard, ProgressBar, ResultDownload
- src/lib/ — detección de tipo, ZIP, límites, utilidades
- tests/fixtures/ — archivos reales chicos para tests
- specs/001-convertitodo/ — spec, plan, data-model, tasks (fuente de verdad, NO tocar
  durante implementación)

## Estilo de trabajo
- Commits  descriptivos en español (conventional commits: feat, fix, test, chore), no agregues coautoria al commit.
- Ante ambigüedad entre el pedido y la spec, gana la spec; avisar la discrepancia.
- No agregar dependencias nuevas sin justificarlas primero.