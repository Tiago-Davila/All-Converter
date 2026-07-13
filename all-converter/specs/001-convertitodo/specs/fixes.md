# Plan de fixes técnicos: ConvertiTodo

**Origen**: auditoría transversal de implementación, 2026-07-12.  
**Alcance**: lógica, conversores, workers, formatos, memoria, PWA, privacidad y pruebas. UI/UX queda fuera de este plan.

## Reglas de ejecución

- Una tarea, un diff y un commit convencional en español.
- TDD: cada corrección comienza por una prueba que reproduzca el problema.
- Ningún archivo de usuario sale del navegador.
- Todo procesamiento superior a ~50 ms se ejecuta en Web Worker.
- Todos los `ArrayBuffer` de entrada y salida se transfieren, no se copian.
- Una tarea se marca `[X]` solamente después de pasar sus pruebas y el build aplicable.

## Fase 1 — Recuperar una base confiable

- [X] FIX001 Reabrir la trazabilidad incorrecta en `specs/001-convertitodo/tasks.md` y añadir pruebas de caracterización que demuestren los gaps actuales de workers, multimedia, imagen real y WebP en `tests/workers/worker-coverage.test.ts`, `tests/converters/media.test.ts`, `tests/converters/image.test.ts` y `tests/converters/images-to-pdf.test.ts`.
- [X] FIX002 Rediseñar el canal worker para soportar múltiples entradas transferibles, opciones tipadas, progreso, resultado, error y cancelación en `src/workers/types.ts`, `src/workers/worker-utils.ts` y `tests/workers/types.test.ts`.
- [X] FIX003 Corregir el ciclo de vida del cliente worker y migrar `runMedia()` al cliente común, cubriendo `onerror`, `onmessageerror`, rechazo de lectura, cleanup de listeners y settle único en `src/workers/client.ts`, `src/converters/media.ts` y `tests/workers/client.test.ts`.
- [X] FIX004 Garantizar buffers transferidos, aborto efectivo y resultados del scheduler en orden de entrada mediante pruebas en `src/lib/job-scheduler.ts`, `tests/lib/job-scheduler.test.ts`, `tests/workers/client.test.ts` y `tests/workers/types.test.ts`.

## Fase 2 — Sacar procesamiento pesado del main thread

- [X] FIX005 Implementar conversión real en `src/workers/image.worker.ts` y dejar `src/converters/image.ts` como adaptador puro.
- [X] FIX006 Implementar operaciones SheetJS, mammoth, docx y jsPDF en `src/workers/office.worker.ts` y migrar los conversores Office.
- [X] FIX007 Implementar lectura/render/extracción en `src/workers/pdf-read.worker.ts` y escritura/manipulación en `src/workers/pdf-write.worker.ts`.
- [X] FIX008 Cargar JSZip dinámicamente fuera del entry y ejecutar compresión pesada en worker.
- [X] FIX009 Probar que cancelar cualquier conversión pesada termina el worker y resuelve en menos de un segundo.

## Fase 3 — Corregir matriz y formatos

- [X] FIX010 Reemplazar el dispatch basado solo en `FileKind` por fuentes MIME/extensión explícitas en el contrato `Converter` y el registry.
- [X] FIX011 Restringir audio/video a los pares trazados por FR-029–FR-031 y rechazar conversiones identidad.
- [X] FIX012 Incorporar trabajos multi-input para imágenes→PDF y unión PDF preservando orden.
- [X] FIX013 Soportar WebP→PDF mediante rasterización local previa.
- [X] FIX014 Validar opciones y formatos dentro de cada worker antes de procesar.

## Fase 4 — Fidelidad y errores documentales

- [X] FIX015 Crear un extractor PDF compartido con orden por página/Y/X, espacios y saltos coherentes.
- [ ] FIX016 Implementar las heurísticas documentadas de títulos, párrafos y listas para PDF→DOCX.
- [ ] FIX017 Renderizar todas las hojas de XLSX en planilla→PDF sin pérdida silenciosa.
- [ ] FIX018 Reemplazar la detección CSV por un parser que respete quoting y validar JSON tabular plano.
- [ ] FIX019 Unificar errores accionables de PDF protegido/corrupto y validar rangos/páginas de manipulación.

## Fase 5 — Media, memoria y offline

- [ ] FIX020 Reportar progreso real de descarga de los assets ffmpeg.
- [ ] FIX021 Añadir un pool exclusivo de concurrencia 1 para audio/video.
- [ ] FIX022 Transferir portada, audio/video y resultados sin structured clone de buffers.
- [ ] FIX023 Liberar `ImageBitmap`, blobs, listeners, workers y WASM en bloques `finally`.
- [ ] FIX024 Excluir WASM y chunks pesados del precache inicial y usar runtime caching local tras primer uso.
- [ ] FIX025 Probar offline después del primer uso sin descargar ambos cores ffmpeg al iniciar la app.

## Fase 6 — Puertas finales

- [ ] FIX026 Añadir conversión real MP4→MP3 con fixtures con audio y sin audio.
- [ ] FIX027 Añadir conversión real MP3→MP4 con portada y waveform.
- [ ] FIX028 Añadir conversiones reales MP3/WAV/OGG/M4A con validación de contenedores.
- [ ] FIX029 Añadir pruebas reales PNG/JPG/WebP, transparencia, animación, dimensiones y memoria.
- [ ] FIX030 Añadir pruebas de navegador para workers, red, offline, compatibilidad y presupuesto del entry.
- [ ] FIX031 Incorporar lint, coverage, bundle budget y detección automática de workers stub como puertas de CI.

## Dependencias

- FIX001 bloquea el resto: define la línea base y reabre trazabilidad.
- FIX002 bloquea FIX003–FIX009 y FIX012.
- FIX003 bloquea todas las migraciones de conversores a workers.
- FIX004 bloquea batch y los pools por dominio.
- Fase 2 bloquea los fixes funcionales de Fases 3–5 para evitar reescrituras dobles.
- Fase 6 se ejecuta al final como validación transversal.
