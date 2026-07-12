# Tasks: ConvertiTodo

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md)

**Regla de ejecución**: una tarea, un diff y un commit convencional en español. Cada conversor incluye su prueba con fixture real. `[P]` significa paralelizable tras sus dependencias.

**Contrato obligatorio de conversores**: toda tarea que cree o modifique un archivo en
`src/converters/` debe exportar un objeto que implemente `Converter`, registrarlo en
`src/converters/registry.ts`, no importar React ni tocar el DOM, y probarlo con un
fixture real en `tests/fixtures/`.

## Phase 1: Setup del proyecto

- [X] T001 Inicializar Vite React 19 con TypeScript estricto y scripts en `package.json`, `tsconfig.json`, `vite.config.ts` y `src/main.tsx`.
- [X] T002 [P] Configurar Tailwind CSS v4 y estilos globales en `src/index.css` y `vite.config.ts`.
- [X] T003 [P] Configurar Vitest y entorno de pruebas en `vitest.config.ts`, `src/test/setup.ts` y `package.json`.
- [X] T004 [P] Crear `vercel.json` con COOP `same-origin` y COEP `require-corp` para todas las rutas.
- [X] T005 [P] Crear la estrategia de fuentes autoalojadas en `public/fonts/` y `src/index.css`, sin CDN runtime.
- [X] T006 Crear estructura inicial y fixtures reales en `src/{components,converters,workers,lib}/` y `tests/fixtures/{sample.docx,sample.xlsx,sample.csv,sample.png,animated.webp,text.pdf,scanned.pdf,protected.pdf,corrupt.pdf,sample.mp3,sample.mp4,silent.mp4}` (depende de T001–T003).

## Phase 2: Núcleo fundacional

- [X] T007 Definir `DetectedFileType`, `FileEntry`, `ConversionJob`, `ConversionResult`, estados y `Converter` en `src/converters/types.ts` conforme a `data-model.md` (depende de T006).
- [X] T008 [P] Implementar detección magic-bytes con fallback de extensión y pruebas en `src/lib/file-type.ts` y `tests/lib/file-type.test.ts` (depende de T007).
- [X] T009 [P] Implementar validación de límites y pruebas en `src/lib/file-limits.ts` y `tests/lib/file-limits.test.ts` (depende de T007).
- [X] T010 Crear registry central y pruebas de destinos por tipo en `src/converters/registry.ts` y `tests/registry/registry.test.ts` (depende de T007–T009).

## Phase 3: UI base

- [X] T011 [US1] Implementar ingreso accesible por selector y drag/drop en `src/components/Dropzone.tsx` (depende de T007–T010).
- [X] T012 [P] [US1] Implementar cola y estados/rechazos en `src/components/FileQueue.tsx` y `src/components/ConversionCard.tsx` (depende de T007–T010).
- [X] T013 [P] [US1] Implementar progreso y descarga local en `src/components/ProgressBar.tsx` y `src/components/ResultDownload.tsx` (depende de T007).
- [X] T014 [US1] Integrar UI con registry sin lógica de conversión en `src/App.tsx` y `src/components/ConversionCard.tsx` (depende de T011–T013).

## Phase 4: Infraestructura de workers

- [X] T015 Crear canal tipado `start/progress/result/error/cancel` y prueba de contratos en `src/workers/types.ts` y `tests/workers/types.test.ts` (depende de T007).
- [X] T016 Implementar fábrica de workers, transferibles, AbortController y terminación, con mock y pruebas en `src/workers/client.ts`, `src/workers/worker-utils.ts` y `tests/workers/client.test.ts` (depende de T015).
- [X] T017 Implementar scheduler de dos trabajos, progreso global y cancelación de lote con pruebas en `src/lib/job-scheduler.ts` y `tests/lib/job-scheduler.test.ts` (depende de T015–T016).
- [X] T018 Implementar cargador dinámico por dominio y medición de chunks en `src/lib/lazy-loader.ts` y `tests/lib/lazy-loader.test.ts` (depende de T016).

## Phase 5: Conversores de imágenes — US1 (P1)

**Objetivo**: convertir una imagen individual con opciones, preview y descarga.

**Prueba independiente**: PNG fixture→JPG/WebP válido; calidad y dimensiones respetadas; archivos inválidos se rechazan.

- [X] T019 [P] [US1] Implementar PNG/JPG/WebP con Canvas/compresión, worker y fixture en `src/converters/image.ts`, `src/workers/image.worker.ts` y `tests/converters/image.test.ts` (depende de T010, T016–T018).
- [X] T020 [US1] Registrar exclusivamente las conversiones de imagen en `src/converters/registry.ts` (depende de T019).
- [X] T021 [US1] Implementar imágenes→PDF con orden y fixture en `src/converters/images-to-pdf.ts`, `src/workers/pdf-write.worker.ts` y `tests/converters/images-to-pdf.test.ts` (depende de T019).

## Phase 6: Conversores de planillas — US2 (P2)

**Prueba independiente**: XLSX fixture→CSV/JSON conserva filas; CSV/JSON tabular→XLSX abre; multihoja crea ZIP.

- [X] T022 [P] [US2] Instalar SheetJS versionado desde CDN oficial y crear wrapper diferido en `package.json`, `src/lib/sheetjs.ts` y `tests/lib/sheetjs.test.ts` (depende de T018).
- [X] T023 [US2] Implementar XLSX/CSV/JSON↔planilla, multihoja y fixtures en `src/converters/spreadsheet.ts`, `src/workers/office.worker.ts` y `tests/converters/spreadsheet.test.ts` (depende de T010, T016–T018, T022).
- [X] T024 [US2] Implementar planilla→PDF y fixture en `src/converters/spreadsheet-to-pdf.ts`, `src/workers/office.worker.ts` y `tests/converters/spreadsheet-to-pdf.test.ts` (depende de T023).

## Phase 7: Conversores de PDF — US3 (P3)

**Prueba independiente**: PDF con texto→imagen/TXT/DOCX; escaneado se rechaza; merge/split/rotación válidos.

- [X] T025 [P] [US3] Configurar carga local de pdfjs y workerSrc bajo COEP con prueba en `src/lib/pdfjs.ts`, `src/workers/pdf-read.worker.ts` y `tests/lib/pdfjs.test.ts` (depende de T018).
- [X] T026 [US3] Implementar PDF→PNG/JPG y PDF→TXT, incluyendo rechazo de escaneado, con fixtures en `src/converters/pdf-extract.ts`, `src/workers/pdf-read.worker.ts` y `tests/converters/pdf-extract.test.ts` (depende de T025).
- [X] T027 [US3] Implementar PDF→DOCX con heurísticas de títulos/párrafos/listas y fixtures en `src/converters/pdf-to-docx.ts`, `src/workers/pdf-read.worker.ts` y `tests/converters/pdf-to-docx.test.ts` (depende de T025).
- [X] T028 [P] [US3] Implementar unir/dividir/rotar PDFs y fixtures en `src/converters/pdf-manipulate.ts`, `src/workers/pdf-write.worker.ts` y `tests/converters/pdf-manipulate.test.ts` (depende de T016, T025).

## Phase 8: Conversores DOCX — US2 (P2)

- [X] T029 [P] [US2] Implementar DOCX→TXT/HTML con mammoth y fixture en `src/converters/docx-text.ts`, `src/workers/office.worker.ts` y `tests/converters/docx-text.test.ts` (depende de T016–T018).
- [X] T030 [US2] Implementar DOCX→PDF con aviso de fidelidad parcial y fixture en `src/converters/docx-to-pdf.ts`, `src/workers/office.worker.ts` y `tests/converters/docx-to-pdf.test.ts` (depende de T029).

## Phase 9: Batch — US4 (P4)

**Prueba independiente**: carpeta de 10 PNG produce ZIP con rutas; tipos mezclados quedan rechazados; fallo parcial conserva éxitos.

- [ ] T031 [US4] Implementar lectura recursiva de carpetas, reglas de aceptación/rechazo y pruebas en `src/lib/directory-input.ts` y `tests/lib/directory-input.test.ts` (depende de T008–T010, T014).
- [ ] T032 [US4] Implementar ZIP con rutas relativas/colisiones y pruebas en `src/lib/zip.ts` y `tests/lib/zip.test.ts` (depende de T009).
- [ ] T033 [US4] Integrar lote, scheduler, errores parciales y descarga ZIP en `src/components/FileQueue.tsx`, `src/App.tsx` y `tests/components/batch-flow.test.tsx` (depende de T017, T031–T032).
- [ ] T034 [P] [US4] Implementar DOCX→XLSX por tablas y fixture en `src/converters/docx-to-xlsx.ts`, `src/workers/office.worker.ts` y `tests/converters/docx-to-xlsx.test.ts` (depende de T022, T029).

## Phase 10: Audio/video — US5 (P5)

**Prueba independiente**: fixtures MP4/MP3 convierten, y sin SAB se muestra modo compatible sin bloquear desktop.

- [ ] T035 [US5] Configurar carga diferida de cores ffmpeg locales, selección MT/ST, indicador de descarga separado del progreso de conversión y tests de capability/progreso en `src/lib/ffmpeg.ts`, `src/workers/media.worker.ts` y `tests/lib/ffmpeg.test.ts` (depende de T004, T016–T018).
- [ ] T036 [US5] Implementar MP4→MP3 y fixture de vídeo con/sin audio en `src/converters/mp4-to-mp3.ts`, `src/workers/media.worker.ts` y `tests/converters/mp4-to-mp3.test.ts` (depende de T035).
- [ ] T037 [US5] Implementar MP3→MP4 con portada/waveform y fixture en `src/converters/mp3-to-mp4.ts`, `src/workers/media.worker.ts` y `tests/converters/mp3-to-mp4.test.ts` (depende de T035).
- [ ] T038 [P] [US5] Implementar conversiones MP3↔WAV/OGG/M4A y fixture en `src/converters/audio.ts`, `src/workers/media.worker.ts` y `tests/converters/audio.test.ts` (depende de T035).

## Phase 11: Pulido y validación transversal — US6 (P6)

- [ ] T039 Implementar PWA/offline solo para assets propios en `vite.config.ts`, `src/sw.ts` y `public/manifest.webmanifest` (depende de T018, T035).
- [ ] T040 [P] Implementar sección de privacidad y avisos de limitación/accesibilidad en `src/components/PrivacyNotice.tsx`, `src/App.tsx` y `src/index.css` (depende de T014).
- [ ] T041 Integrar previews, confirmación de recarga y validación manual de quickstart en `src/App.tsx`, `src/components/ResultDownload.tsx` y `tests/components/app-flow.test.tsx` (depende de T020–T040).
- [ ] T042 Ejecutar y documentar validación final de build, tests, preview COOP/COEP, offline y red en `specs/001-convertitodo/quickstart.md` (depende de T039–T041, T043–T046).
- [ ] T043 [P] [US3] Añadir pruebas de PDF protegido, corrupto y escaneado para PDF→TXT y PDF→DOCX en `tests/converters/pdf-extract.test.ts`, `tests/converters/pdf-to-docx.test.ts` y `tests/fixtures/{protected.pdf,corrupt.pdf,scanned.pdf}` (depende de T026–T027).
- [ ] T044 Añadir pruebas y mensajes para 0 bytes, extensión engañosa, límite excedido, CSV ilegible, PNG/WebP animado, transparencia→JPG y memoria insuficiente en `tests/lib/file-type.test.ts`, `tests/lib/file-limits.test.ts`, `tests/converters/image.test.ts` y `tests/converters/spreadsheet.test.ts` (depende de T008–T009, T019, T023).
- [ ] T045 Integrar opciones/preview de imagen, avisos previos de limitaciones y confirmación de recarga/cierre en `src/components/ConversionCard.tsx`, `src/components/NavigationGuard.tsx`, `src/App.tsx` y `tests/components/app-flow.test.tsx` (depende de T020, T030, T037, T040).
- [ ] T046 Ampliar la validación manual de compatibilidad, móvil, máximo de tres acciones y respuesta UI <100 ms en `specs/001-convertitodo/quickstart.md` (depende de T041, T045).

## Dependencias y paralelismo

- Setup T001–T006 bloquea núcleo T007–T010; núcleo/UI/workers T007–T018 bloquean conversores.
- Tras T018, las fases de imágenes (T019), planillas (T022–T024), PDF (T025–T028) y DOCX (T029–T030) pueden avanzar en paralelo con archivos distintos.
- Batch depende del núcleo y de resultados de conversores; media depende de workers y Vercel; pulido depende de los incrementos deseados.

## Estrategia de entrega

MVP: T001–T021 y T045 (US1 completo: imagen, preview y descarga). Después, Office/DOCX (US2), PDF (US3), lote (US4), media (US5) y privacidad/offline final (US6). Cada tarea se valida y se commitea aisladamente.
