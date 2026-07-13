# ConvertiTodo

Convertidor de archivos 100% client-side. Todo el procesamiento ocurre en el navegador
mediante JavaScript y WebAssembly. Los archivos del usuario **nunca abandonan su máquina**:
no hay backend, no hay base de datos, no hay telemetría, no hay llamadas a APIs externas.

---

## Funcionalidades

### Imágenes
| Conversión | Detalles |
|---|---|
| PNG / JPG / WebP ↔ PNG / JPG / WebP | Calidad configurable (1–100%), ancho máximo opcional. La transparencia se aplana sobre blanco al convertir a JPG. |
| Imágenes → PDF | Múltiples imágenes a un único PDF, una página por imagen, orden reordenable. |

### Planillas
| Conversión | Detalles |
|---|---|
| XLSX / CSV / JSON ↔ XLSX / CSV / JSON | Soporte de hojas múltiples; archivos multi-hoja generan un ZIP. El JSON debe ser tabular (array de objetos planos). |
| XLSX / CSV → PDF | Tabla con encabezados y paginación automática. |

### PDF
| Conversión | Detalles |
|---|---|
| PDF → TXT | Extracción de texto en orden de lectura. Rechaza PDFs escaneados (sin capa de texto). |
| PDF → Imágenes | Una imagen PNG o JPG por página. |
| PDF → DOCX | Heurísticas de título por tamaño de fuente. Fidelidad parcial: texto y estructura básica, sin diseño ni imágenes. |
| PDF merge | Une varios PDFs en uno. |
| PDF split | Divide un PDF por páginas o rangos. |
| PDF rotate | Rota páginas individuales o el documento completo. |

### Documentos
| Conversión | Detalles |
|---|---|
| DOCX → TXT / HTML | Extracción de texto y marcado con `mammoth`. |
| DOCX → PDF | Solo texto. Fidelidad parcial declarada. |
| DOCX → XLSX | Extrae tablas del documento (una hoja por tabla). |

### Audio y vídeo
| Conversión | Detalles |
|---|---|
| MP4 → MP3 | Extrae la pista de audio. Rechaza vídeos sin audio. |
| MP3 → MP4 | Genera un vídeo con portada elegida por el usuario o waveform animado. |
| MP3 / WAV / OGG / M4A ↔ MP3 / WAV / OGG / M4A | Conversión cruzada de formatos de audio. |

> Las conversiones de audio y vídeo no están disponibles en dispositivos móviles
> debido a las limitaciones de memoria y de soporte de WebAssembly en esos navegadores.

---

## Stack

| Herramienta | Rol |
|---|---|
| React 19 + Vite + TypeScript estricto | Framework y bundler |
| Tailwind CSS v4 | Estilos utilitarios |
| `@ffmpeg/ffmpeg` + `@ffmpeg/core[-mt]` | Audio/vídeo vía WASM (MT si `SharedArrayBuffer` disponible, ST como fallback) |
| `pdfjs-dist` | Lectura y extracción de PDFs |
| `pdf-lib` | Generación y manipulación de PDFs |
| `mammoth` | Extracción de texto desde DOCX |
| `docx` | Generación de archivos DOCX |
| `xlsx` (SheetJS) | Planillas XLSX/CSV/JSON |
| `jsPDF` + `jspdf-autotable` | Generación de PDFs con tablas |
| `file-type` | Detección de tipo por magic bytes |
| `JSZip` | Empaquetado ZIP |
| `browser-image-compression` | Compresión de imágenes |
| `vite-plugin-pwa` + Workbox | PWA / Service Worker / offline |
| Vitest + Playwright | Tests unitarios y E2E |

---

## Arquitectura

### Principio de privacidad
Cero peticiones de red con contenido de archivos del usuario. Una inspección de tráfico durante cualquier conversión muestra exactamente cero solicitudes salientes que contengan datos del archivo.

### Conversor → Worker → UI
```
UI (registry) → Converter → Web Worker → resultado → UI
```

- La UI solo conoce el **registry** (`src/converters/registry.ts`). Nunca importa un conversor directamente.
- Cada conversor implementa la interfaz `Converter` (`src/converters/types.ts`) y declara `maxSizeMB`. La UI rechaza archivos que superen el límite **antes** de intentar convertir, con mensaje claro.
- Toda conversión pesada corre en un **Web Worker**. El main thread nunca se bloquea. Los `ArrayBuffer` se transfieren como transferables, no se copian.
- Las librerías pesadas (ffmpeg.wasm, pdfjs-dist, SheetJS, mammoth, docx) se cargan con **`dynamic import()`** solo cuando se necesitan. Bundle inicial < 200 KB gzip.
- El tipo de archivo se detecta por **magic bytes** (`file-type`). La extensión solo se usa como fallback.

### Concurrencia
El scheduler (`src/lib/job-scheduler.ts`) limita la concurrencia a 2 conversiones simultáneas en general, y a 1 para conversiones de audio/vídeo.

### ffmpeg y `SharedArrayBuffer`
`@ffmpeg/core-mt` (modo multi-thread) requiere `crossOriginIsolated = true`, que a su vez requiere los headers `COOP: same-origin` y `COEP: require-corp`. Si el contexto no es aislado, la app degrada automáticamente a `@ffmpeg/core` (single-thread). Los headers están definidos en `vercel.json` y en la configuración de Vite para desarrollo y preview.

> **Importante**: COEP bloquea recursos externos en runtime. Todas las fuentes, shaders
> y assets se sirven desde el bundle. No se usa ningún CDN en runtime.

---

## Comandos

```bash
npm run dev          # servidor de desarrollo
npm run build        # build de producción (verificar tamaño de chunks)
npm run preview      # probar el build local (necesario para verificar COOP/COEP)
npm run test         # tests unitarios con Vitest
npm run test:e2e     # tests E2E con Playwright
npm run test:coverage # cobertura con V8
npm run lint         # ESLint
npm run ci           # pipeline completo: lint → coverage → build → budget → workers → offline → e2e
```

---

## Estructura

```
all-converter/
├── src/
│   ├── converters/    # un módulo por conversión + registry + types
│   ├── workers/       # workers de conversión con canal tipado
│   ├── components/    # Dropzone, FileQueue, ConversionCard, ProgressBar, ResultDownload
│   └── lib/           # detección de tipo, ZIP, límites, ffmpeg, pdfjs, sheetjs, scheduler
├── tests/
│   ├── fixtures/      # archivos reales pequeños para tests
│   ├── converters/    # tests de conversores
│   ├── lib/           # tests de utilidades
│   ├── workers/       # tests de workers
│   ├── registry/      # tests del registry
│   ├── components/    # tests de flujos React
│   └── e2e/           # tests Playwright en navegador real
├── specs/
│   ├── 001-convertitodo/   # spec, plan, data-model, tasks (fuente de verdad)
│   └── 002-capa-experiencia/ # spec de la capa de experiencia (en progreso)
├── scripts/           # presupuesto de bundle, stubs de workers, verificación offline
├── public/fonts/      # fuentes self-hosted (no CDN)
└── vercel.json        # headers COOP/COEP — no quitar
```

---

## Tests

Los tests requieren un fixture real en `tests/fixtures/`. Ningún conversor se acepta sin test con archivo real.

```bash
npm run test           # todos los tests unitarios
npm run test:coverage  # con informe de cobertura (umbral: 60% líneas/funciones)
npm run test:e2e       # Playwright (requiere build o servidor dev activo)
npm run test:budget    # verifica que el bundle inicial esté dentro del presupuesto
```

---

## Despliegue

La app se despliega como sitio estático en **Vercel**. No hay funciones serverless ni backend de ningún tipo.

Los headers de `vercel.json` son obligatorios:

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "Cross-Origin-Opener-Policy",   "value": "same-origin" },
      { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
    ]
  }]
}
```

Sin estos headers, ffmpeg.wasm multi-thread no funciona y las fuentes self-hosted no cargarían bajo COEP.

---

## Gestión del proyecto

Este proyecto usa **Spec-Driven Development** con [GitHub Spec Kit](https://github.com/speckit). La fuente de verdad está en `specs/001-convertitodo/`. No se implementa nada que no esté trazado a una tarea de `tasks.md`. Una tarea, un diff, un commit.

Los principios de diseño del proyecto están en `.specify/memory/constitution.md` (v1.1.0).

### Puertas de merge
1. Trazabilidad a una tarea de `tasks.md`.
2. Test con fixture real en `tests/fixtures/`.
3. TypeScript estricto sin `any` no justificado.
4. Tamaño de chunks verificado con `npm run build`.
5. Contraste WCAG AA verificado; ningún estado distinguible solo por color; todos los controles operables por teclado.
6. Todo evento sonoro con equivalente visual; respeta silencio por defecto y `prefers-reduced-motion`.
7. Ningún asset de audio, shader o fuente referencia un origen externo en runtime.
