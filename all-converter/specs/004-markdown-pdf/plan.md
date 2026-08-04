# Implementation Plan: Markdown ↔ PDF

**Input**: [spec.md](./spec.md)

## Decisiones técnicas

### D1 — Parser propio, sin dependencias

`Claude.md` prohíbe sumar dependencias sin justificarlas y el Principio V fija el
presupuesto de 200 KB gzip. `marked` + `turndown` resolverían CommonMark completo, pero:

- el renderizador solo sabe dibujar 5 tipos de bloque, así que el 90 % de CommonMark no
  tendría a dónde ir;
- el repositorio ya parsea HTML y ODF con expresiones regulares (`office-doc-render.ts`),
  así que un parser propio es lo **consistente**, no la excepción;
- Markdown se parsea por líneas, que es mucho más simple que HTML anidado.

### D2 — Markdown produce `Block[]`, no un tipo nuevo

`markdownToBlocks` devuelve el mismo `Block[]` que ya consumen DOCX y ODT, y
`renderBlocksToPdf` **no se toca**. Consecuencias: cero riesgo de regresión en las
conversiones existentes, y Markdown hereda gratis el arreglo de escala de imágenes de 005.

### D3 — El serializador consume `DocumentBlock`, el tipo del dominio PDF

`inferDocumentBlocks` ya devuelve `heading1 | heading2 | paragraph | list | table` con
`bold`/`italic` por run: es exactamente lo que necesita Markdown. `pdfDocx`
(`pdf-operations.ts:35`) hace el mismo recorrido para generar DOCX, así que `pdfMarkdown` es
su gemelo con otro serializador. No hay heurística nueva que escribir ni que testear.

### D4 — Dos dominios de worker distintos, ninguno nuevo

`md-to-pdf` va al worker de Office, porque ahí vive `renderBlocksToPdf` y sus imports
dinámicos de jsPDF. `pdf-to-md` va al de lectura de PDF, junto a `pdf-to-txt` y
`pdf-to-docx`, y **no** entra al `Set` `writeOperations` de `src/converters/pdf.ts`: si
entrara caería en `pdf-write.worker.ts` y arrastraría `pdf-lib` a ese chunk sin necesidad.

### D5 — Escapado al escribir, no al leer

El riesgo real del ida y vuelta es que un texto que contiene `*` o `|` se reinterprete como
marcado al reabrir el `.md`. Se resuelve **al escribir** (FR-008), escapando los caracteres
activos y las secuencias que abrirían bloque al principio de línea. Al leer no hace falta
nada: un `\*` escapado se desescapa naturalmente.

### D6 — Las imágenes del Markdown solo se aceptan como data URI

`![alt](foto.png)` no se puede resolver: no hay disco al que ir, y salir a la red violaría
el Principio II. Se ignora en silencio en vez de romper el documento, igual que hace hoy
`imageBlockFromDataUri` con los formatos que no reconoce.

### D7 — `.md` se detecta por extensión

Markdown no tiene magic bytes, así que `fileTypeFromBlob` devuelve `undefined` y el `kind`
sale del mapa de extensiones. Sin sumar `md`/`markdown` ahí, el archivo se clasifica
`unknown` y `intakeFiles` lo rechaza **antes** de llegar al registry. Es el fallback que la
Regla 7 prevé para formatos sin firma, no una violación.

## Arquitectura

```
markdown-parse.ts ──> Block[] ──> renderBlocksToPdf ──> PDF
        ▲                          (sin modificar)
        │
  office-operations.ts (md-to-pdf) ──> office.worker.ts


  pdf-operations.ts (pdf-to-md)
        │
        ├── extractPdfLayout ──> inferDocumentBlocks ──> DocumentBlock[]
        │                                                     │
        └────────────────> markdown-write.ts <────────────────┘
                                  │
                                  ▼
                              texto .md
```

## Constitution check

| Regla | Cómo se cumple |
|---|---|
| 1 — nada sale del dispositivo | Parsers puros sobre el buffer de entrada; las imágenes por URL se ignoran en vez de descargarse |
| 2 — spec-driven | Esta carpeta; tareas en `tasks.md` |
| 3 — Converter + registry | Dos `Converter` registrados; la UI solo suma tarjetas en la vitrina |
| 4 — conversores sin React | `markdown-parse.ts` y `markdown-write.ts` son puros, sin DOM |
| 5 — trabajo pesado en worker | `md-to-pdf` en el worker de Office, `pdf-to-md` en el de lectura |
| 6 — bundle < 200 KB | Sin dependencias nuevas; `test:budget` en la verificación |
| 7 — magic bytes | Markdown no tiene firma: se usa el fallback por extensión previsto por la regla |
| 8 — TS estricto + test con fixture | Sin `any`; `tests/fixtures/sample.md` real y unitarios de ambos módulos |
| 9 — maxSizeMB | 25 MB, igual que el resto de los conversores de documentos |
| XV — honestidad de la interfaz | Ambos declaran `limitation`; el PDF escaneado se rechaza con el mensaje de OCR existente |
