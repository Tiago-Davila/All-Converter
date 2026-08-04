# Tasks: Markdown ↔ PDF

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Regla de ejecución**: una tarea, un diff, un commit convencional en español. Ninguna tarea
se cierra sin su test. `[P]` = paralelizable tras sus dependencias.

---

## Phase 1: Markdown a bloques

- **T001** — `src/workers/markdown-parse.ts`: `markdownToBlocks(md): Block[]`. Encabezados
  ATX y Setext, párrafos, listas ordenadas/no ordenadas con anidación, tablas GFM, citas,
  bloques de código cercados e indentados, y `inlineMarkdownRuns` para énfasis, código
  inline, enlaces e imágenes con data URI. Sin DOM. (FR-005, FR-006)
- **T002** — `tests/workers/markdown-parse.test.ts`: un caso por construcción, más los
  bordes — énfasis sin cerrar, tabla sin fila separadora, lista interrumpida por párrafo,
  fence sin cerrar, imagen por URL ignorada, escapes `\*`. Depende de T001.

## Phase 2: Bloques a Markdown

- **T003** — `src/workers/markdown-write.ts`: `blocksToMarkdown(blocks): string` sobre
  `DocumentBlock` de `pdf-docx-structure.ts`. Encabezados, listas con sangría por nivel,
  tablas GFM con fila separadora, runs con `**`/`*`, y `escapeMarkdown` para el texto
  plano. (FR-008)
- **T004** — `tests/workers/markdown-write.test.ts`: cada tipo de bloque; escapado de
  `*_[]#|` y de las secuencias que abrirían bloque al principio de línea; tabla con filas
  de distinto largo; runs vacíos. Depende de T003.

## Phase 3: Conversor MD → PDF

- **T005** — `src/lib/file-type.ts`: `md` y `markdown` como `document` en el mapa de
  extensiones. (FR-004)
- **T006** — `src/converters/sources.ts`: `MARKDOWN_SOURCE`. (FR-001)
- **T007** — `src/workers/office-operations.ts`: `mdPdf()` y la rama `md-to-pdf` en
  `executeOfficeOperation`; `src/workers/validation.ts`: rama en `validateOfficeRequest`.
  Depende de T001. (FR-001, FR-007)
- **T008** — `src/converters/markdown-to-pdf.ts` + registro en `registry.ts`. Depende de
  T006, T007. (FR-003, FR-010)
- **T009 [P]** — `tests/fixtures/sample.md` + `tests/converters/markdown-to-pdf.test.ts`:
  end-to-end contra el fixture real. Depende de T008.

## Phase 4: Conversor PDF → MD

- **T010** — `src/workers/pdf-operations.ts`: `pdfMarkdown()` y la rama `pdf-to-md`;
  `src/workers/validation.ts`: sumar `'pdf-to-md'` a la lista de operaciones de lectura.
  Depende de T003. (FR-002, FR-009)
- **T011** — `src/converters/pdf-to-markdown.ts` + registro en `registry.ts`. **No** tocar
  `writeOperations` de `src/converters/pdf.ts`. Depende de T010. (FR-003, FR-012)
- **T012 [P]** — `tests/converters/pdf-to-markdown.test.ts`: convierte el PDF generado por
  `md-to-pdf` y verifica la estructura; rechazo del PDF escaneado con el fixture existente.
  Depende de T011.

## Phase 5: Vitrina, scripts y documentación

- **T013** — `src/ui/components/FormatsShowcase.tsx`: tarjetas de las dos conversiones
  nuevas (el archivo pide mantenerlas 1:1 con el registry).
- **T014 [P]** — `scripts/check-worker-stubs.mjs`: `'md-to-pdf'` en `evidence.office` y
  `'pdf-to-md'` en `evidence['pdf-read']`; `README.md`: filas nuevas en la tabla de
  documentos.

## Phase 6: Verificación

- **T015** — Verificación completa: `npm run lint`, `npm run test`, `npm run build`,
  `npm run test:budget`, `npm run test:workers`, `npm run test:offline`.
