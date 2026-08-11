# Estado de la implementación — 006-lotes-grandes

**Última actualización**: 2026-08-11 | **Rama**: `006-lotes-grandes` | **Sin commitear**

> ⚠️ **Lo más importante que tenés que saber antes de seguir**: el código **compila**
> (`npx tsc -b` pasa limpio) pero **la suite de tests NUNCA se ejecutó**. Se interrumpió justo
> antes de correr `npx vitest run`. Todo lo marcado como "hecho" abajo está escrito y tipado,
> **no verificado en ejecución**. El primer paso al retomar es correr los tests y esperar
> roturas.

---

## Cómo retomar (en este orden)

```bash
cd all-converter
npx vitest run          # PRIMERO ESTO. Hay roturas conocidas esperadas, ver abajo.
```

### Roturas que doy por seguras

1. **`tests/lib/zip.test.ts`** — usa la API vieja: `createZip([{ name, buffer }])` con
   `ArrayBuffer` y espera un `ArrayBuffer` de vuelta. Ahora `ZipEntry` lleva `blob: Blob` y
   `createZip` devuelve `Blob`. Hay que reescribir el test (es la tarea T012/T013).
2. **`tests/lib/directory-input.test.ts`** — tiene el literal `'Límite de 10'` en las
   aserciones y el tope ahora es 200 (tarea T009).
3. **`tests/components/batch-flow.test.tsx`** — el ZIP ya no se arma al terminar el lote sino
   al hacer clic en "Descargar ZIP", y el elemento pasó de `<a href>` a `<button>`. Cualquier
   aserción sobre el link del ZIP va a fallar. Es un cambio de diseño deliberado, ver abajo.
4. Posible: tests que dependan del orden de detección en `intakeFiles`, que ahora es
   concurrente (aunque el orden de salida se preserva por índice).

---

## Decisión de diseño que se tomó durante la implementación

**El ZIP se arma al hacer clic, no al terminar el lote.**

No estaba en el plan aprobado; salió de un detalle que apareció al implementar:
`showSaveFilePicker()` **exige activación transitoria del usuario**, así que no se puede
llamar automáticamente al final del lote. Armarlo on-demand además:

- hace trivial FR-010 (no se rearma si nadie lo pide);
- elimina de raíz el defecto de la UI trabada (ya no hay empaquetado en el camino de
  `convertAll`);
- no gasta CPU ni memoria empaquetando algo que el usuario quizá no descargue.

**Consecuencia visible**: la barra de "Descargar todo" ahora aparece apenas hay resultados y su
control es un `<button>` con estado "Empaquetando… N%", en vez de un `<a href>` con un blob ya
listo. Los tests que miren el link hay que adaptarlos.

---

## Lo que está hecho (escrito y tipado, SIN correr tests)

### Fase 2 — Foundational

| Tarea | Estado | Archivo |
|---|---|---|
| T003 `resultsRef` a `Blob` | ✅ escrito | `src/components/FileQueue.tsx` |
| T004 `ZipEntry`/`ZipInput` con `Blob` | ✅ escrito | `src/lib/zip.ts`, `src/workers/types.ts` |
| T005 `try/finally` en `convertAll` | ✅ escrito | `src/components/FileQueue.tsx` |
| T006 test del defecto de UI trabada | ❌ **falta** | `tests/components/batch-flow.test.tsx` |
| T007 filtro O(n²) → `Set` | ✅ escrito | `src/components/FileQueue.tsx` (`packagedEntries`) |
| T008 mover `error-class.ts` a `lib/` | ❌ **falta** | — |

### Fase 3 — US1

| Tarea | Estado | Archivo |
|---|---|---|
| T009–T013 tests de US1 | ❌ **faltan todos** | `tests/lib/*`, `tests/components/*` |
| T014 escritor ZIP STORE incremental | ✅ escrito | `src/workers/zip-operations.ts` |
| T015 canal de chunks + `onChunk` | ✅ escrito | `src/workers/types.ts`, `client.ts` |
| T016 emitir chunks | ✅ escrito | `src/workers/zip.worker.ts` |
| T017 sink `showSaveFilePicker` + fallback | ✅ escrito | `src/lib/zip.ts` (`saveZip`) |
| T018 no rearmar el ZIP | ✅ por diseño | on-demand, ver arriba |
| T019 `MAX_BATCH_FILES = 200` | ✅ escrito | `src/lib/directory-input.ts` |
| T020 cupo antes de detectar | ✅ escrito | `src/lib/directory-input.ts` |
| T021 detección concurrente | ✅ escrito | `src/lib/directory-input.ts` |
| T022 techo de exploración | ✅ escrito | `src/lib/directory-input.ts` |
| T023 serializar aportes | ✅ escrito | `src/App.tsx` (`intakeChain`) |
| T024 fila resumen de rechazos | ✅ escrito | `src/components/FileQueue.tsx` |
| T025 particionar concurrencia | ❌ **falta** | `src/lib/job-scheduler.ts` |

### Fases 4, 5 y 6 — sin empezar

US2 (watchdog, reintento, resumen), US3 (pausa/reanudación) y Polish (memoización,
throttling, e2e, README) están **sin tocar**. `tasks.md` tiene el detalle T026–T046.

---

## Detalle de lo implementado, para poder revisarlo

### `src/workers/zip-operations.ts` — reescrito entero

Escritor ZIP STORE incremental. `streamZip()` es un `AsyncGenerator<Uint8Array>` que lee **un
blob por vez** con `blob.arrayBuffer()` y suelta los bytes antes del siguiente. Incluye tabla
CRC32 propia, `ByteWriter` little-endian, y rechazo con mensaje si la suma supera 4 GB (sin
ZIP64). `executeZip()` se conserva para juntar todo en un `ArrayBuffer`.

**Está validado por spike fuera del repo** (52 entradas, round-trip contra `JSZip.loadAsync`,
bytes OK, `ñandú-café.txt` OK, subcarpetas OK) pero **no por un test del repo**.

### `src/lib/directory-input.ts` — reescrito

- `MAX_BATCH_FILES = 200`, `MAX_SCAN_FILES = 5000`.
- `readDroppedItems` ahora devuelve `{ files, skipped }` en vez de un array. **Cambio de API**:
  los dos `Dropzone` ya están adaptados.
- `intakeFiles` detecta **por olas** del tamaño del cupo libre. Es más sutil de lo que parece:
  un tipo no soportado no consume cuota, así que si una ola deja lugar, la siguiente lo
  aprovecha. Eso preserva la semántica original (donde el chequeo de tipo iba antes que el de
  cupo) sin leer bytes de archivos que no podrían entrar ni en el mejor caso.

  > Ojo: una primera versión de esto tenía un bug —reservaba cupo y lo "devolvía" después, lo
  > que hacía que un archivo válido tardío quedara afuera injustamente. Se corrigió con el
  > esquema de olas. Si tocás esta función, el test de T010 es el que protege esa semántica.

### `src/lib/zip.ts` — reescrito

`saveZip(entries, signal, onProgress)` devuelve `{ kind: 'saved' }` (se escribió a disco con
File System Access) o `{ kind: 'blob', blob }` (fallback Firefox/Safari, el llamador dispara la
descarga). Los chunks se encadenan con una promesa para garantizar orden de escritura.
`createZip` se conserva devolviendo `Blob`, para tests.

### `src/components/FileQueue.tsx`

`registerResults` crea **un solo `Blob`** que alimenta a la vez la descarga individual y el
ZIP. `convertAll` entero en `try/finally`. `downloadAll()` nuevo. Barra de ZIP con estado de
empaquetado y fila de error propia. Fila resumen de rechazos por cupo/exploración.

---

## Riesgos y cosas a mirar con desconfianza

1. **Nada está verificado en ejecución.** Es el riesgo principal.
2. **El escritor ZIP es código de formato binario.** El spike da confianza pero no reemplaza al
   test de round-trip con ≥200 entradas (T012). Es la primera prueba que escribiría.
3. **`intakeFiles` por olas** — la lógica de cupo es la parte más sutil del diff.
4. **La transferencia del chunk** en `zip.worker.ts` usa `[chunk.buffer]` como transferable. Si
   `streamZip` alguna vez devolviera vistas sobre un buffer compartido, transferirlo rompería
   las siguientes. Hoy cada chunk tiene su propio buffer, pero es una precondición implícita
   que conviene no romper.
5. **`ct-zipbar-link` ahora es un `<button>`**, no un `<a>`. Revisar que el CSS de
   `src/index.css` no asuma `<a>` (color de link, subrayado).
6. **Sin commits.** Todo el trabajo está en el working tree de la rama `006-lotes-grandes`.
   El proyecto pide un commit por tarea; conviene commitear por tramo al validar cada uno.

---

## Archivos tocados

```
M all-converter/.specify/feature.json          apunta a specs/006-lotes-grandes
M all-converter/package-lock.json              npm install (no se agregaron dependencias)
M all-converter/src/App.tsx
M all-converter/src/components/Dropzone.tsx    (código muerto, adaptado para que compile)
M all-converter/src/components/FileQueue.tsx   ← el grueso del cambio
M all-converter/src/lib/directory-input.ts     ← reescrito
M all-converter/src/lib/zip.ts                 ← reescrito
M all-converter/src/ui/components/Dropzone.tsx
M all-converter/src/workers/client.ts
M all-converter/src/workers/types.ts
M all-converter/src/workers/validation.ts
M all-converter/src/workers/worker-utils.ts
M all-converter/src/workers/zip-operations.ts  ← reescrito
M all-converter/src/workers/zip.worker.ts      ← reescrito
? all-converter/specs/006-lotes-grandes/       spec, plan, research, contracts, tasks, este archivo
```

**No se agregó ninguna dependencia.** El `package-lock.json` cambió sólo por correr
`npm install` (`node_modules` no estaba instalado).

---

## Documentos de la feature

| Archivo | Qué tiene |
|---|---|
| `spec.md` | 23 requisitos, 10 criterios de éxito, 3 historias. La evidencia del estado actual con archivo y línea |
| `research.md` | D1–D8. **D1 es el importante**: la medición que descartó JSZip |
| `plan.md` | Constitution Check y Complexity Tracking |
| `data-model.md` | Entidades y transiciones de estado |
| `contracts/` | `zip-stream.md`, `job-scheduler.md`, `reliability.md` |
| `tasks.md` | T001–T046, con dependencias y conflictos de archivo |
| `quickstart.md` | Cómo validar cada historia |
| `ESTADO.md` | Este archivo |
