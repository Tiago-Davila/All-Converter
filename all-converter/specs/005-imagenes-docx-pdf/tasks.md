# Tasks: Tamaño real de las imágenes al convertir a PDF

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Regla de ejecución**: una tarea, un diff, un commit convencional en español. Ninguna tarea
se cierra sin su test. `[P]` = paralelizable tras sus dependencias.

---

## Phase 1: Unidades y huella (núcleo puro)

- **T001** — `src/workers/docx-image-size.ts`: `emuToMm(emu)` (`emu / 914400 * 25.4`),
  `fnv1a32(bytes)` y `imageFingerprint(bytes)` (`${length}:${hash}`). Sin DOM.
  (FR-001, FR-004)
- **T002** — `src/workers/office-doc-render.ts`: `odfLengthToMm(value)` exportada — acepta
  `mm`, `cm`, `in`, `pt`, `pc`, `px`; rechaza vacío, sin unidad, cero y negativo.
  (FR-001, FR-002)
- **T003 [P]** — `tests/workers/docx-image-size.test.ts` + `office-doc-render.test.ts`:
  `emuToMm(914400) === 25.4`; `odfLengthToMm` para `'5.291cm'`, `'2in'`, `'150pt'`, `'43mm'`,
  `'96px'`, `'1pc'`, y `undefined` para `'abc'`, `'0cm'`, `'-3cm'`, `'12'`. Depende de
  T001, T002.

## Phase 2: Extractor de tamaños del DOCX

- **T004** — `tests/helpers/docx.ts`: `packDocx()` con JSZip (espejo de `tests/helpers/odf.ts`),
  que arma un `.docx` mínimo que mammoth acepta — `word/document.xml`,
  `word/_rels/document.xml.rels`, `word/media/*`, `[Content_Types].xml` — con las URIs de
  namespace transitional exactas. Helpers para los casos adversarios: dibujo sin `a:blip`,
  imagen sin `wp:extent`, prefijo de namespace no canónico. (FR-004, FR-007)
- **T005** — `src/workers/docx-image-size.ts`: `extractDocxImageSizes(zip)`. Resuelve
  prefijos por URI de namespace; lee `word/_rels/document.xml.rels` normalizando igual que
  mammoth (`uris.js`); recorre `<{wp}:inline>`/`<{wp}:anchor>` tomando `<{wp}:extent>` **solo
  si el dibujo tiene `<a:blip r:embed>`**; agrupa por huella del contenido. Guardas de
  cordura de FR-006. Depende de T001, T004. (FR-001, FR-004, FR-006, FR-007)
- **T006 [P]** — `tests/workers/docx-image-size.test.ts`: gráfico sin blip antes de la imagen
  (la imagen conserva su tamaño); dos imágenes con extents distintos; la misma parte repetida
  con el mismo extent; sin `wp:extent`; prefijo `zz:`; `a:ext` de `pic:spPr` que **no** debe
  confundirse con `wp:extent`; `cx="0"` descartado. Depende de T005.

## Phase 3: Modelo de bloques y dibujado

- **T007** — `src/workers/office-doc-render.ts`: `DisplaySize` y `display?` en el bloque
  imagen; `htmlToBlocks(html, resolveDisplay?)`; `imageBlockFromBytes(bytes, href, display?)`;
  `odfImages` itera `<draw:frame>` y mergea el `display` **sin** cambiar la firma de
  `OdfImageResolver`, con el recorrido plano como fallback. (FR-001, FR-002)
- **T008** — `src/workers/office-doc-render.ts`: bloque de dibujo de `renderBlocksToPdf` —
  tamaño de visualización o píxeles a 96 dpi, `shrink = Math.min(1, maxW/w, maxH/h)`, guarda
  de valores no finitos. **Solo encoge.** Depende de T007. (FR-003, FR-005)
- **T009** — `tests/workers/office-doc-render.test.ts`: helper `drawnImagesMm(buffer)` que
  parsea el operador `cm` del content stream. Casos: `display` respetado; clamp a 180×90;
  sin display a 96 dpi; **regresión del defecto** (PNG 1×1 mide < 1 mm, hoy 180); alto que
  fuerza salto de página con una sola imagen dibujada; varias imágenes sin duplicados.
  Depende de T008. (FR-011)

## Phase 4: Cableado y honestidad

- **T010** — `src/workers/office-operations.ts`: `docxPdf` abre el `.docx` con JSZip, arma el
  `DisplayLookup` y se lo pasa a `htmlToBlocks`; `odtPdf` sin cambios de firma. Degrada a
  FR-002 si el zip no se puede leer. Depende de T005, T007. (FR-005, FR-008, FR-009)
- **T011 [P]** — Casos end-to-end con dimensiones reales en
  `tests/converters/docx-to-pdf.test.ts` y `tests/converters/odt-to-pdf.test.ts`, incluida la
  variante con gráfico previo. Los paquetes se arman con `packDocx()`/`buildOdt()`, igual que
  ya hace el proyecto con los fixtures ODF: no hay ningún DOCX con imágenes escrito por Word
  en `tests/fixtures/` y no se puede generar uno auténtico desde este entorno. `pngOfSize()`
  produce PNG **realmente válidos** (IDAT comprimido con zlib), no un IHDR parcheado: jsPDF
  decodifica la imagen al incrustarla y `renderBlocksToPdf` se traga los errores de
  `addImage`, así que una imagen inválida desaparecería del PDF en silencio y el test mediría
  cero imágenes en vez de fallar por la razón real. Depende de T010. (FR-011)
- **T012 [P]** — `src/converters/docx-to-pdf.ts` y `src/converters/odt-to-pdf.ts`: texto de
  `limitation` que declare qué se conserva y qué no (posición de flotantes, recorte, imágenes
  en tablas). Depende de T010. (FR-010)

## Phase 5: Verificación

- **T013** — Verificación completa: `npm run lint`, `npm run test`, `npm run build`,
  `npm run test:budget`, `npm run test:workers`, `npm run test:offline`.
