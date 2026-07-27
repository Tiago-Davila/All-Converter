# Implementation Plan: Redimensionador de imágenes

**Input**: [spec.md](./spec.md)

## Decisiones técnicas

### D1 — La matemática vive en un módulo puro, no en el worker

Hoy el cálculo de tamaño está inline en `src/workers/image.worker.ts:35-37` y **no tiene
ningún test unitario**, porque probarlo exige `createImageBitmap`/`OffscreenCanvas`, que no
existen en Node ni jsdom. La lógica nueva va a `src/lib/image-resize.ts`: sin DOM, sin
React, testeable en Vitest node. El worker y la UI comparten ese módulo, así que el
invariante FR-007 se define **una sola vez**.

### D2 — Operación nueva en el worker existente, no worker nuevo

`image.worker.ts` gana una rama `image-resize` junto a `image-convert`. Razones:

- `scripts/check-worker-stubs.mjs` exige que `image.worker.ts` contenga literalmente
  `createImageBitmap` y `convertToBlob`; `tests/workers/worker-coverage.test.ts` lo grepea.
  Extraer el canvas a un `image-operations.ts` rompe ambos.
- Un worker separado duplicaría el mismo código de decode/encode.
- El camino de `image-convert` (validación + `Math.min(1, …)`) queda **byte a byte igual**.

La diferencia funcional: `image-resize` recibe `width`/`height` **exactos** y no clampea a
1, por lo que puede agrandar (FR-008).

### D3 — Sin whitelist de mime de entrada en la validación

`validateImageResizeRequest` **no** filtra el mime de entrada, a diferencia de
`validateImageRequest`. Es deliberado: FR-002 pone la frontera en lo que el navegador
decodifica, y `createImageBitmap` ya falla con un error que `imageErrorMessage` traduce.
La salida sí se valida contra `['image/png','image/jpeg','image/webp']`.

### D4 — Ruteo por hash, sin dependencias nuevas

No hay router en el proyecto y `Claude.md` prohíbe sumar dependencias sin justificar.
`react-router` no se justifica para dos vistas. `src/ui/routing.ts` expone
`useHashRoute()` (~15 líneas, `useSyncExternalStore` sobre `hashchange`). Los enlaces son
`<a href="#/redimensionar">`, así que no hay props que plomear por el árbol.

`App` decide la vista al principio del render; el estado de la cola vive en un `useRef` que
no se desmonta, así que ir y volver lo conserva (FR-015).

### D5 — Las dimensiones naturales salen de la vista previa

Leer el tamaño real exigiría decodificar la imagen. En vez de decodificar dos veces (una
para medir, otra para convertir) o de agregar una operación `probe` al canal de workers, la
página usa el `<img>` de la vista previa —que igual hay que renderizar— y lee
`naturalWidth`/`naturalHeight` en `onLoad`. El `onError` del mismo `<img>` es además la
detección gratis de "este formato tu navegador no lo abre" (FR-002).

### D6 — `image-resize` no entra al registry

Ver "Discrepancias" en la spec. Implementa `Converter` para reusar `startWorker` y el
patrón de conversión, pero no se exporta desde `registry.ts`.

## Arquitectura

```
ResizePage.tsx  ──uses──> lib/image-resize.ts   (matemática pura, compartida)
      │                          ▲
      │                          │
      └──calls──> converters/image-resize.ts    │
                         │                      │
                         └──postMessage──> workers/image.worker.ts
                                                 │
                                    workers/validation.ts ──────┘
```

## Constitution check

| Regla | Cómo se cumple |
|---|---|
| 1 — nada sale del dispositivo | Solo `createImageBitmap` + `OffscreenCanvas`, cero red |
| 2 — spec-driven | Esta carpeta; tareas en `tasks.md` |
| 3 — Converter + registry | Implementa `Converter`; **no** se registra (discrepancia avisada) |
| 4 — conversores sin React | `converters/image-resize.ts` no importa React |
| 5 — trabajo pesado en worker | Todo el escalado en `image.worker.ts`, buffers transferidos |
| 6 — bundle < 200 KB | Sin dependencias nuevas; `npm run test:budget` en la verificación |
| 7 — magic bytes | `detectFileType` de `lib/file-type.ts` |
| 8 — TS estricto + test con fixture | `tests/lib/`, `tests/ui/`, e2e con `tests/fixtures/sample.png` |
| 9 — maxSizeMB | 50 MB, igual que `imageConverter` |
