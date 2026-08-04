# Feature Specification: Markdown ↔ PDF

**Feature Branch**: `004-markdown-pdf`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Hacé un plan para convertir un nuevo formato, quiero que se pueda hacer la conversión de Markdown > PDF y PDF > Markdown."

## Contexto y frontera con 001 / 003

Markdown es un **formato nuevo** dentro de la matriz de conversión de 001: hoy ninguno de
los 17 conversores del registry acepta ni produce `.md`. A diferencia de 003, esta feature
**sí** entra por el camino normal (Regla 3): dos `Converter` registrados en `registry.ts`,
sin páginas ni UI propias.

Se apoya en dos piezas que ya existen y hacen exactamente lo necesario:

- **MD → PDF**: `renderBlocksToPdf` (`src/workers/office-doc-render.ts`) ya compone PDFs a
  partir de un `Block[]` con encabezados, párrafos, listas, tablas e imágenes. Es el mismo
  modelo que consumen DOCX y ODT. Solo falta producir ese `Block[]` desde Markdown.
- **PDF → MD**: `extractPdfLayout` + `inferDocumentBlocks` (`src/workers/pdf-layout.ts` y
  `pdf-docx-structure.ts`) ya infieren `heading1 | heading2 | paragraph | list | table` con
  `bold`/`italic` por run. Es literalmente lo que usa `pdf-to-docx`. Solo falta serializar.

## Clarifications

### Session 2026-08-04

- Q: ¿Se agrega una dependencia de Markdown (`marked`, `markdown-it`, `turndown`)? → A: **No.** Parser propio con expresiones regulares, en el estilo de `htmlToBlocks`. `Claude.md` prohíbe sumar dependencias sin justificarlas y el Principio V fija el presupuesto de bundle. La cobertura que se necesita —encabezados, listas, tablas, énfasis— es una fracción de CommonMark.
- Q: ¿Qué dialecto de Markdown se soporta? → A: **CommonMark básico más tablas GFM**, que es lo que el renderizador sabe dibujar. Lo que excede al modelo de bloques queda fuera de alcance y se declara.
- Q: ¿Se soportan imágenes en el Markdown de entrada? → A: **Solo data URIs incrustadas.** Una imagen por ruta o URL exigiría leer del disco o de la red: lo primero no aplica a un archivo suelto y lo segundo viola el Principio II. Se ignoran en silencio, sin romper el documento.
- Q: ¿PDF → Markdown recupera imágenes? → A: **No.** `inferDocumentBlocks` trabaja sobre la capa de texto; las imágenes del PDF no se extraen. Se declara como limitación antes de convertir.
- Q: ¿Qué pasa con un PDF escaneado? → A: **Se rechaza con el mismo mensaje que `pdf-to-txt` y `pdf-to-docx`**, que ya explica que haría falta OCR y está fuera de alcance (Principio XV).
- Q: ¿Cómo se detecta un `.md`, si no tiene magic bytes? → A: **Por extensión**, que es el fallback previsto por la Regla 7. Hay que sumar `md`/`markdown` al mapa de `file-type.ts` o el archivo se rechaza como `unknown` antes de llegar al registry.
- Q: ¿El PDF de salida usa el mismo renderizador que DOCX/ODT? → A: **Sí**, sin modificarlo. Eso hereda gratis el arreglo de escala de imágenes de 005.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un README se vuelve un PDF legible (Priority: P1)

Un usuario arrastra un `README.md` con títulos, listas y una tabla. Elige PDF y descarga un
documento paginado donde los títulos se ven más grandes, las listas tienen viñetas y la
tabla tiene encabezado y bordes.

**Why this priority**: es la mitad del pedido y el caso de uso dominante de Markdown.

**Acceptance**:
1. `#`, `##`, `###` producen encabezados de tamaño decreciente.
2. `-`/`*`/`+` producen viñetas y `1.` produce numeración.
3. Una tabla GFM produce una tabla con fila de encabezado.
4. `**negrita**` e `*itálica*` se ven aplicados en el PDF.

### User Story 2 - Un PDF se vuelve Markdown editable (Priority: P1)

Un usuario convierte un PDF con estructura a `.md` y obtiene un archivo de texto con `#`
para los títulos, `-` para las listas y tablas en formato GFM, listo para editar.

**Acceptance**:
1. Los títulos inferidos por tamaño de fuente salen como `#` / `##`.
2. Las listas salen como `-`, con sangría según el nivel.
3. Las tablas salen en formato GFM con su fila separadora.
4. Los runs en negrita e itálica salen como `**…**` y `*…*`.
5. Un PDF sin capa de texto se rechaza con el mensaje de OCR ya existente.

### User Story 3 - El texto no se corrompe al ida y vuelta (Priority: P2)

Un usuario convierte MD → PDF → MD. El resultado no es idéntico —no puede serlo— pero
ningún carácter del texto original aparece roto ni transformado en marcado accidental.

**Acceptance**:
1. Un texto que contiene `*`, `_`, `#`, `|` o `` ` `` se escapa al escribir Markdown, de modo
   que no se reinterpreta como marcado.
2. El contenido textual sobrevive al ida y vuelta.

## Requirements *(mandatory)*

- **FR-001**: Existe un conversor `md-to-pdf` que acepta `.md`/`.markdown` y produce PDF.
- **FR-002**: Existe un conversor `pdf-to-md` que acepta PDF y produce `.md` con mime
  `text/markdown`.
- **FR-003**: Ambos se registran en `src/converters/registry.ts` e implementan `Converter`
  (Regla 3). La UI no se modifica salvo la vitrina de formatos.
- **FR-004**: `.md` y `.markdown` se reconocen como `document` en `src/lib/file-type.ts`;
  la detección es por extensión, el fallback que prevé la Regla 7 para formatos sin firma.
- **FR-005**: El parser de Markdown cubre: encabezados ATX (`#`…`######`) y Setext,
  párrafos, listas ordenadas y no ordenadas con anidación, tablas GFM, citas, bloques de
  código (cercados e indentados), énfasis (`**`, `__`, `*`, `_`), código inline, enlaces e
  imágenes con data URI.
- **FR-006**: Una imagen cuya fuente no sea un data URI se ignora sin romper el documento
  (Principio II: no se sale a buscarla).
- **FR-007**: El PDF se compone con `renderBlocksToPdf`, **sin modificarlo**, de modo que
  Markdown hereda el tratamiento de imágenes de 005.
- **FR-008**: El serializador a Markdown escapa los caracteres que reintroducirían marcado
  (`\`, `` ` ``, `*`, `_`, `[`, `]`, `#`, `|`) y las secuencias que abrirían bloque al
  principio de línea.
- **FR-009**: Un PDF sin capa de texto se rechaza con el mensaje de OCR ya existente.
- **FR-010**: Ambos conversores declaran `maxSizeMB: 25` (Regla 9) y `limitation`, que se
  muestra **antes** de convertir (Principio XV).
- **FR-011**: Sin dependencias nuevas y sin cambios en el presupuesto de bundle (Reglas 6
  y 8 de la constitución). El trabajo corre en los Web Workers existentes (Regla 5):
  `md-to-pdf` en el de Office, `pdf-to-md` en el de lectura de PDF.
- **FR-012**: `pdf-to-md` **no** se agrega al conjunto `writeOperations` de
  `src/converters/pdf.ts`, para que siga cayendo en `pdf-read.worker.ts` y no arrastre
  `pdf-lib` ni `docx` a ese chunk.
- **FR-013**: Ningún byte sale del dispositivo (Regla 1).

### Key Entities

- **Block** (ya existe, `office-doc-render.ts`): el modelo intermedio que consume
  `renderBlocksToPdf`. Markdown produce este tipo, no uno nuevo.
- **DocumentBlock** (ya existe, `pdf-docx-structure.ts`): lo que infiere el PDF. El
  serializador consume este tipo.

## Out of Scope

- **HTML embebido** dentro del Markdown: se emite como texto plano. Interpretarlo exigiría
  el parser de HTML completo y no hay modelo de bloques para la mayoría de las etiquetas.
- **Footnotes, listas de tareas, definiciones y tablas con alineación**: el renderizador no
  tiene primitivas para representarlas.
- **Front-matter YAML**: se descarta si abre el archivo, no se convierte en metadatos.
- **Reglas horizontales** (`---`): `renderBlocksToPdf` no dibuja líneas.
- **Imágenes en PDF → Markdown**: `inferDocumentBlocks` trabaja sobre la capa de texto.
- **Ida y vuelta fiel**: MD → PDF → MD conserva el texto y la estructura gruesa, no el
  formato exacto. Es inherente a pasar por un formato de presentación.
- **Resaltado de sintaxis** en los bloques de código.
- **El algoritmo de delimitadores de CommonMark**: la anidación de énfasis con el **mismo**
  carácter (`**muy *fuerte***`) se resuelve parcialmente. Mezclando delimitadores
  (`**muy _fuerte_**`) o con el triple (`***ambas***`) funciona como se espera. Resolverlo
  del todo exigiría el algoritmo completo de delimiter runs, desproporcionado para los
  cinco tipos de bloque que sabe dibujar el renderizador.

## Discrepancias con las reglas del proyecto

Ninguna. La feature entra por el camino normal del registry.
