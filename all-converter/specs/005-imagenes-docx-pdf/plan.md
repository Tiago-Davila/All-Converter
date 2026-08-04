# Implementation Plan: Tamaño real de las imágenes al convertir a PDF

**Input**: [spec.md](./spec.md)

## Decisiones técnicas

### D1 — Asociar por huella de contenido, no por posición

La solución intuitiva —"el N-ésimo `wp:extent` corresponde a la N-ésima `<img>` del HTML de
mammoth"— **está rota**. Verificado contra el código de `mammoth@1.12.0`:

- `readDrawingElement` (`lib/docx/body-reader.js`) exige la cadena **shallow**
  `a:graphicData > pic:pic > pic:blipFill > a:blip`. Un gráfico de Excel, un SmartArt, un
  cuadro de texto o un grupo (`wpg:wgp`) tienen `wp:extent` y producen **cero** `<img>`:
  desde ahí todos los índices se corren.
- EMF/WMF/SVG: mammoth **sí** emite el `<img>` (`supportedImageTypes` solo genera un
  warning), pero `imageBlockFromDataUri` solo acepta `png|jpe?g` y lo descarta: el índice se
  corre al revés.
- VML legacy (`<w:pict><v:imagedata>`) emite `<img>` y **no** tiene `wp:extent`.
- Las notas al pie viven en `word/footnotes.xml`, no en `document.xml`, y mammoth las
  concatena al final del HTML.
- `mc:AlternateContent` sin `mc:Fallback`: `wp:extent` sí, `<img>` no.

Por eso la clave es el **contenido de la imagen**: `${bytes.length}:${fnv1a32(bytes)}`.
`htmlToBlocks` ya decodifica los bytes del data URI para llamar a `imageSize()`, así que la
consulta no cuesta ninguna decodificación extra.

### D2 — `convertImage` de mammoth no sirve

Descartado tras leer el código: `documents.Image()` (`lib/documents.js`) expone únicamente
`read*`, `altText` y `contentType`. Mammoth **nunca** lee `wp:extent`, así que el hook no
tiene ningún tamaño que ofrecer. Además `ImageAttributes` (`lib/index.d.ts`) declara solo
`src`, sin index signature: inyectar un atributo propio exigiría un cast, y la Regla 8
prohíbe `any`.

### D3 — Extractor en módulo aparte, worker sin lógica nueva

`extractDocxImageSizes` vive en `src/workers/docx-image-size.ts`: sin DOM, sin React,
testeable en Vitest node. Sigue el patrón de `office-doc-render.ts` (parseo por regex, no por
DOM: los workers no tienen `DOMParser`). `office-operations.ts` solo lo cablea, igual que ya
hace con el resolver de imágenes de ODT (`odtPdf`, líneas 76-93).

### D4 — `display` opcional, firmas retrocompatibles

El bloque imagen gana `display?: { wmm, hmm }`. Al ser **opcional**:

- los literales de `tests/workers/office-doc-render.test.ts:75,88` siguen compilando;
- `htmlToBlocks(html, resolveDisplay?)` e `imageBlockFromBytes(bytes, href, display?)` suman
  un parámetro opcional al final: las llamadas existentes no se tocan;
- **`OdfImageResolver` no cambia de firma**. El merge del `display` lo hace `odfImages`
  después de invocar al resolver, así que el test que pasa `() => ({...})` sigue pasando.

Se prefiere `display?: {wmm,hmm}` anidado antes que `displayWmm?`/`displayHmm?` sueltos: es
atómico (no existe el estado "medio seteado") y el renderizador hace un solo chequeo.

### D5 — El clamp replica la forma de `fitPair` de 003

`src/lib/image-resize.ts` ya resolvió este problema con `scale = Math.min(1, ...)`. Se
replica la **forma**, no el módulo: allá los topes son píxeles (1920/1080) y acá son
milímetros de la caja útil de A4, así que compartir las constantes sería acoplar dos cosas
que solo se parecen.

### D6 — ODT no necesita abrir el zip dos veces

En DOCX el tamaño está en otra parte del paquete (`word/document.xml`) y hay que ir a
buscarlo. En ODT está en el **mismo** `content.xml` que ya se parsea: basta con envolver el
recorrido de `<draw:image>` dentro de su `<draw:frame>` para leer `svg:width`/`svg:height`.
Se conserva el recorrido plano de `<draw:image>` como fallback para ODT sin frame.

### D7 — La verificación mira las dimensiones dibujadas, no la validez del PDF

Esto es lo que dejó pasar el defecto: `office-doc-render.test.ts:88` renderiza un PNG de 1×1
estirado a 180 mm y **pasa**, porque solo comprueba que el archivo sea un PDF válido. Y no
hay ningún fixture DOCX con imágenes (`sample.docx`, `table.docx` y `notables.docx` no tienen
`word/media/*`).

`new jsPDF()` no comprime (`compress` es `false` por defecto), así que el content stream va
en texto plano — la misma razón por la que el test actual puede buscar `'Producto'` en
latin1. `writeImageToPDF` emite `q\n<w> 0 0 <h> <x> <y> cm\n/I<n> Do\nQ` en puntos, así que
un regex sobre el buffer devuelve las dimensiones reales en mm.

## Arquitectura

```
office-operations.ts (docxPdf)
   │
   ├── JSZip ──> docx-image-size.ts ──> DisplayLookup  (huella de bytes → mm)
   │                                          │
   └── mammoth ──> htmlToBlocks(html, ────────┘
                        resolveDisplay)
                            │
                            ▼
                        Block[] con display?
                            │
   office-operations.ts (odtPdf) ──> odfContentToBlocks ──┤
       (svg:width del draw:frame)                         │
                                                          ▼
                                              renderBlocksToPdf
                                          (clamp: solo encoge, nunca agranda)
```

## Constitution check

| Regla | Cómo se cumple |
|---|---|
| 1 — nada sale del dispositivo | Solo JSZip y regex sobre el buffer de entrada, cero red |
| 2 — spec-driven | Esta carpeta; tareas en `tasks.md` |
| 3 — Converter + registry | No se agregan conversores; el registry no se toca |
| 4 — conversores sin React | `docx-image-size.ts` es puro, sin DOM ni React |
| 5 — trabajo pesado en worker | Todo dentro de `office.worker.ts`, sin cambios de protocolo |
| 6 — bundle < 200 KB | Sin dependencias nuevas (JSZip ya lo usa `odtPdf`); `test:budget` en la verificación |
| 7 — magic bytes | `imageSize()` ya lee PNG/JPEG por firma, no por extensión |
| 8 — TS estricto + test con fixture | `display?` opcional sin `any`; `packDocx()` genera fixtures reales y se suma `image.docx` binario |
| 9 — maxSizeMB | Sin cambios: 25 MB en ambos conversores |
| XV — honestidad de la interfaz | FR-010: se corrigen los textos de `limitation` |
