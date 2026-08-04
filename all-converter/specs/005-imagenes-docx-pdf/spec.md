# Feature Specification: Tamaño real de las imágenes al convertir a PDF

**Feature Branch**: `005-imagenes-docx-pdf`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Agregar una extensión para arreglar la conversión de Word a PDF en imágenes, fijate que se agrandan o que la resolución cambia."

## Contexto y frontera

Esta feature **no agrega una conversión nueva**: corrige una que ya existe. `docx-to-pdf` y
`odt-to-pdf` comparten el renderizador `renderBlocksToPdf` de
`src/workers/office-doc-render.ts`, así que el defecto y el arreglo alcanzan a **las dos**.

Lo que **queda intacto**: el registry, la UI, la cola, el resto de los conversores, y el
camino de texto/listas/tablas del propio renderizador. El único cambio de comportamiento
visible es el tamaño con el que se dibujan las imágenes.

### El defecto

`src/workers/office-doc-render.ts:326-337` dibuja **toda** imagen al ancho útil completo de
la página:

```ts
let drawW = maxW                       // 180 mm en A4
let drawH = (block.h / block.w) * drawW
```

`block.w`/`block.h` —los píxeles intrínsecos que `imageSize()` sí lee del PNG/JPEG— se usan
**solo** para la relación de aspecto, nunca para la escala. Una imagen que en Word mide 5 cm
sale a 18 cm. El aspecto se conserva, así que no hay deformación: es puro agrandado.

Causa secundaria: `mammoth.convertToHtml()` se llama sin opciones y emite `<img>` sin
`width`/`height`, de modo que el tamaño de visualización que el usuario fijó en Word se
pierde. Ese dato solo está en `word/document.xml` (`wp:extent`, en EMU).

Dato objetivo: en todo el repositorio no existe ninguna conversión px↔pt↔mm (búsqueda de
`914400`, `EMU`, `25.4`, `dpi`: cero resultados).

## Clarifications

### Session 2026-08-04

- Q: ¿Qué tamaño debe tener la imagen en el PDF? → A: **El tamaño con el que se ve en el documento original** (`wp:extent` en DOCX, `svg:width`/`svg:height` en ODT), no los píxeles intrínsecos. Es lo que el usuario percibe como "correcto".
- Q: ¿Y si el documento no declara tamaño de visualización? → A: **Píxeles intrínsecos a 96 dpi** (`px * 25.4 / 96`), la convención de Word y de los navegadores para imágenes sin escala explícita.
- Q: ¿Se puede agrandar una imagen para que llene la página? → A: **No.** Solo se encoge, y únicamente cuando no entra en la caja útil. Agrandar es exactamente el defecto que se está corrigiendo.
- Q: ¿Cómo se asocia cada `wp:extent` con su imagen, si mammoth solo devuelve bytes? → A: **Por huella del contenido de la imagen**, no por posición. La correlación posicional está rota (ver FR-004).
- Q: ¿Qué pasa si la asociación falla o el dato es basura? → A: **Cae a píxeles intrínsecos**, por imagen. Un fallo nunca contamina a las demás imágenes del documento.
- Q: ¿Se resuelve también el caso de las imágenes dentro de tablas? → A: **No**, queda fuera de alcance. Es un defecto distinto y preexistente del parser, no del dibujado.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Una imagen de Word conserva su tamaño (Priority: P1)

Un usuario tiene un `.docx` con una captura insertada y reducida a 5 cm de ancho. Lo
convierte a PDF y la imagen se ve de 5 cm, igual que en Word, con el texto fluyendo
alrededor en el mismo orden.

**Why this priority**: es el defecto reportado y por sí solo justifica la feature.

**Acceptance**:
1. Una imagen con `wp:extent` de 2 in × 1 in se dibuja de 50,8 mm × 25,4 mm (±0,01).
2. El PDF sigue siendo válido y el texto del documento se conserva.
3. La misma corrección aplica a ODT vía `svg:width`/`svg:height`.

### User Story 2 - Una imagen enorme no rompe la página (Priority: P1)

Un usuario inserta una foto de 4000 px que en el documento ocupa media hoja. En el PDF entra
en la página, sin desbordar el margen ni cortarse.

**Acceptance**:
1. Si el tamaño pedido excede la caja útil, se encoge conservando la proporción.
2. Nunca supera `180 mm` de ancho ni `262 mm` de alto (A4 con los márgenes vigentes).
3. Una imagen que no entra en el resto de la página abre página nueva y entra completa.

### User Story 3 - Un documento con gráficos no descoloca las imágenes (Priority: P1)

Un usuario tiene un `.docx` con un gráfico de Excel seguido de una foto. La foto sale con
**su** tamaño, no con el del gráfico.

**Why this priority**: es el caso que invalida la solución ingenua y el motivo del diseño
por huella de contenido.

**Acceptance**:
1. Un `wp:inline` sin `a:blip` (gráfico, SmartArt, cuadro de texto, grupo) no aporta tamaño
   a ninguna imagen.
2. Una imagen que mammoth emite pero el renderizador descarta (EMF, WMF, SVG) no corre el
   tamaño de las siguientes.

### User Story 4 - Sin tamaño declarado, un tamaño sensato (Priority: P2)

Un documento generado por herramientas que no escriben `wp:extent` produce imágenes a su
tamaño natural en pantalla, no a página completa.

**Acceptance**:
1. Sin tamaño de visualización, una imagen de 100 px de ancho mide 26,46 mm (96 dpi).
2. Sin tamaño de visualización, una imagen de 2000 px se encoge al ancho útil.

## Requirements *(mandatory)*

- **FR-001**: Una imagen se dibuja en el PDF con el tamaño de visualización declarado por el
  documento original: `wp:extent` (EMU) en DOCX, `svg:width`/`svg:height` en ODT.
- **FR-002**: Sin tamaño declarado, se usan los píxeles intrínsecos a 96 dpi
  (`px * 25.4 / 96`), leídos con el `imageSize()` que ya existe.
- **FR-003**: El tamaño resultante **solo se encoge**, nunca se agranda, y únicamente para
  entrar en la caja útil de la página, conservando la proporción.
- **FR-004**: La asociación entre un tamaño declarado y su imagen se hace **por huella del
  contenido**, no por posición. La correlación posicional está rota: un `wp:inline` con
  gráfico/SmartArt/cuadro de texto tiene `wp:extent` pero no produce imagen, y un EMF/SVG
  produce imagen que el renderizador descarta. Cualquiera de los dos corre todos los índices
  posteriores.
- **FR-005**: Todo fallo de asociación o dato inválido degrada **por imagen** a FR-002, sin
  afectar a las demás ni abortar la conversión (se conserva el `try/catch` actual).
- **FR-006**: Se aceptan como válidos solo tamaños finitos, positivos y menores a 5000 mm; y
  se descarta la asociación si el aspecto declarado difiere del intrínseco en más de 20×.
- **FR-007**: El parseo del XML resuelve los **prefijos de namespace reales** desde las
  declaraciones `xmlns:`, porque el prefijo literal no está garantizado.
- **FR-008**: El trabajo sigue enteramente dentro del Web Worker de Office, sin red
  (Reglas 1 y 5 de `Claude.md`).
- **FR-009**: Sin dependencias nuevas: JSZip ya se usa en `odtPdf` (Regla 6).
- **FR-010**: Los textos de `limitation` de `docx-to-pdf` y `odt-to-pdf` dejan de prometer
  fidelidad de imágenes sin matices y declaran lo que sigue sin cubrirse (Principio XV:
  la limitación se comunica **antes** de convertir).
- **FR-011**: Las dimensiones dibujadas se verifican en test inspeccionando el operador `cm`
  del content stream del PDF, no solo la validez del archivo.

### Key Entities

- **DisplaySize**: `{ wmm: number; hmm: number }` — tamaño de visualización en milímetros.
  Opcional en el bloque imagen: su ausencia significa "usá FR-002".
- **DisplayLookup**: `(bytes: Uint8Array) => DisplaySize | undefined` — resuelve el tamaño a
  partir del contenido de la imagen.

## Out of Scope

- **Imágenes dentro de tablas**: se siguen perdiendo. El regex de `htmlToBlocks` consume el
  `<table>` entero y `cellText()` borra el `<img>`. Es un defecto del parser, preexistente y
  ajeno al dibujado; arreglarlo exige rediseñar el modelo de tabla (hoy `string[][]`).
- **Recorte** (`a:srcRect`): se dibuja la imagen completa al tamaño del recorte.
- **Posición absoluta** de las imágenes flotantes (`wp:anchor`): se dibujan en el flujo.
- **Rotación** de imágenes (`a:xfrm rot`).
- **Imágenes de headers y footers**: mammoth no lee esas partes del documento.
- **Re-muestreo de los píxeles** de la imagen: se ajusta la geometría del dibujado, no los
  bytes. El PDF conserva la resolución original, que es lo deseable para imprimir.
- **`images-to-pdf`**: usa pdf-lib y trata píxeles como puntos (una foto de 3000 px genera
  una página de ~106 cm). Es un defecto de tamaño de papel, distinto de este, y cambiarlo
  alteraría una conversión que hoy se ve correcta.

## Discrepancias con las reglas del proyecto

Ninguna. La feature no agrega conversores ni toca el registry ni la UI.
