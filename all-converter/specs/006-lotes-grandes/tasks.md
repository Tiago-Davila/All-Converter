---

description: "Task list for 006-lotes-grandes"
---

# Tasks: Lotes grandes y confiables

**Input**: Design documents from `/specs/006-lotes-grandes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: OBLIGATORIOS. El Principio VIII de la constitución es "sin test no hay merge", y la
puerta de merge (2) exige test con fixture real. No son opcionales en este proyecto.

**Organization**: agrupadas por historia de usuario. Una tarea, un diff, un commit
(conventional commits en español, sin trailer de co-autoría).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: US1, US2, US3
- Rutas relativas a `all-converter/`

---

> **Estado de avance**: ver [ESTADO.md](./ESTADO.md). Parte de la Fase 2 y de la Fase 3 ya está
> escrita y tipada, pero **la suite de tests todavía no se ejecutó ni una vez**. Al retomar,
> correr `npx vitest run` antes que nada.

## Phase 1: Setup

**Purpose**: fixtures y andamiaje que necesitan las demás fases

- [ ] T001 [P] Agregar fixture de carpeta con ≥60 imágenes reales pequeñas en `tests/fixtures/lote-grande/` y un helper que la cargue en `tests/helpers/batch.ts`
- [ ] T002 [P] Agregar al helper `tests/helpers/batch.ts` un conversor doble que se cuelga sin reportar progreso (para el watchdog) y otro que falla con causa determinística

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: memoria y robustez del empaquetado. Todo lo demás se apoya acá.

**⚠️ CRÍTICO**: ninguna historia puede empezar hasta que esta fase esté completa.

- [ ] T003 Migrar `resultsRef` a `Blob` en `src/components/FileQueue.tsx`: cambiar el tipo a `{ name: string; blob: Blob; relativePath?: string }` y hacer que `registerResults` envuelva el `ArrayBuffer` del worker en `Blob` y suelte la referencia en el acto (data-model.md §Resultado retenido)
- [ ] T004 Cambiar `ZipEntry` a `{ name; blob: Blob; relativePath? }` en `src/lib/zip.ts` y propagar el tipo a `WorkerInput` en `src/workers/types.ts` sin romper los conversores existentes
- [ ] T005 Corregir el defecto de UI trabada en `src/components/FileQueue.tsx`: envolver la llamada de empaquetado en `try/catch` y mover `setRunning(false)` a un `finally`; saltear el empaquetado si el lote fue cancelado (FR-009, contracts/zip-stream.md §Errores)
- [ ] T006 [P] Escribir el test que reproduce ese defecto en `tests/components/batch-flow.test.tsx`: cancelar el lote habiendo resultados previos NO debe dejar `running` en true ni el botón de convertir deshabilitado
- [ ] T007 [P] Reemplazar el filtro O(n²) de resultados empaquetados por un `Set` de ids en `src/components/FileQueue.tsx` (hoy `Object.entries(...).filter(([id]) => entries.some(...))`)
- [ ] T008 [P] Mover `src/ui/components/error-class.ts` a `src/lib/error-class.ts` y dejar en la ruta vieja un reexport, para que `tests/ui/components/error-class.test.ts` y los consumidores actuales sigan verdes (research.md D8)

**Checkpoint**: los resultados ya no duplican bytes en el heap y el empaquetado no puede trabar la UI.

---

## Phase 3: User Story 1 - Convertir una carpeta grande completa (Priority: P1) 🎯 MVP

**Goal**: 200 archivos entran, se convierten y se descargan en un ZIP, sin agotar la memoria.

**Independent Test**: soltar una carpeta de 60+ archivos, convertir, descargar el ZIP y
verificar que tiene todas las entradas con los bytes correctos.

### Tests for User Story 1

> Escribir estos tests ANTES de la implementación y verificar que fallan.

- [ ] T009 [P] [US1] Test de cupo en `tests/lib/directory-input.test.ts`: 200 aceptados, el 201 rechazado, el cupo cuenta entradas preexistentes, y actualizar las aserciones que hoy tienen el literal `'Límite de 10'`
- [ ] T010 [P] [US1] Test en `tests/lib/directory-input.test.ts` que espía el módulo de detección y verifica que **`detectFileType` no se invoca para los excedentes de cupo** (FR-002), y que vacío y tipo-no-soportado siguen rechazándose por su causa sin consumir cuota
- [ ] T011 [P] [US1] Test del techo de exploración en `tests/lib/directory-input.test.ts`: `readDroppedItems` corta en `MAX_SCAN_FILES` e informa cuántos ignoró (FR-003)
- [ ] T012 [P] [US1] Test de round-trip del ZIP en `tests/lib/zip.test.ts`: escribir ≥200 entradas con el escritor nuevo y releerlas con `JSZip.loadAsync`; verificar fidelidad de bytes, rutas relativas, colisiones (`informe-2.pdf`), subcarpetas y nombres con acentos (contracts/zip-stream.md §Invariantes)
- [ ] T013 [P] [US1] Test en `tests/lib/zip.test.ts` de que el empaquetado lee de a un blob por vez (instrumentar `arrayBuffer()` y verificar que no hay más de una lectura viva simultánea) y de que se rechaza con aviso si la suma supera 4 GB

### Implementation for User Story 1

- [ ] T014 [US1] Implementar el escritor ZIP STORE incremental en `src/workers/zip-operations.ts`: cabecera local + bytes + directorio central + EOCD, flag UTF-8 `0x800`, tabla CRC32 propia; leer un `Blob` por vez con `blob.arrayBuffer()` y emitir chunks (contracts/zip-stream.md)
- [ ] T015 [US1] Agregar la respuesta `{ kind: 'chunk'; jobId; chunk: Uint8Array }` en `src/workers/types.ts` y el callback opcional `onChunk` en `src/workers/client.ts`, sin que una respuesta `chunk` resuelva el trabajo y posteando el buffer como transferable
- [ ] T016 [US1] Emitir los chunks desde `src/workers/zip.worker.ts` conservando el orden
- [ ] T017 [US1] Implementar el sink de descarga en `src/lib/zip.ts`: escribir a `showSaveFilePicker()` si existe, y si no acumular chunks y cerrar en un único `new Blob(chunks)` (contracts/zip-stream.md §Destino)
- [ ] T018 [US1] Evitar rearmar el ZIP cuando no se agregaron resultados nuevos desde el último empaquetado, en `src/components/FileQueue.tsx` (FR-010)
- [ ] T019 [US1] Subir `MAX_BATCH_FILES` a 200 y agregar `MAX_SCAN_FILES = 5000` en `src/lib/directory-input.ts`
- [ ] T020 [US1] Reordenar `intakeFiles` en `src/lib/directory-input.ts` para evaluar el cupo ANTES de llamar a `detectFileType`, preservando que vacío y tipo-no-soportado se evalúen primero y no consuman cuota (research.md D7)
- [ ] T021 [US1] Detectar el tipo de los archivos que sí entran con `runWithConcurrency` en `src/lib/directory-input.ts`, conservando el orden determinista de las entradas
- [ ] T022 [US1] Cortar el recorrido recursivo en `readDroppedItems` al llegar a `MAX_SCAN_FILES` y devolver cuántos quedaron sin explorar, en `src/lib/directory-input.ts`
- [ ] T023 [US1] Serializar los aportes de archivos en `src/App.tsx` para que dos arrastres casi simultáneos no puedan pasarse del cupo (FR-005)
- [ ] T024 [US1] Colapsar los rechazos por cupo en una sola fila resumen en `src/components/FileQueue.tsx`, con cantidad y motivo, manteniendo fila propia para vacío y tipo-no-soportado (FR-004, data-model.md §RechazoAgregado)
- [ ] T025 [US1] Particionar la concurrencia en dos grupos (audio/video a 1, resto a 2) en `src/lib/job-scheduler.ts` y `src/components/FileQueue.tsx`, eliminando el `reduce`/`Math.min` global (FR-017, contracts/job-scheduler.md §Particionado)

**Checkpoint**: una carpeta de 200 archivos se convierte y se descarga completa.

---

## Phase 4: User Story 2 - Un archivo roto no arruina el lote (Priority: P1)

**Goal**: los fallos quedan aislados, explicados y —cuando tiene sentido— reintentables.

**Independent Test**: lote mixto de sanos y rotos; los sanos terminan, cada roto muestra su
causa y el reintento aparece sólo en los transitorios.

### Tests for User Story 2

- [ ] T026 [P] [US2] Test de watchdog en `tests/components/batch-flow.test.tsx`: un conversor que no reporta progreso se aborta al vencer el plazo, queda en `error` de clase transitoria y el lote continúa con los demás (FR-015)
- [ ] T027 [P] [US2] Test en `tests/components/batch-flow.test.tsx` de que el reintento aparece en el 100% de los fallos transitorios y en el 0% de los determinísticos (FR-013, SC-005)
- [ ] T028 [P] [US2] Test en `tests/components/batch-flow.test.tsx` de que reintentar reprocesa **sólo** ese archivo y no toca los resultados de los demás (FR-014)
- [ ] T029 [P] [US2] Test en `tests/components/batch-flow.test.tsx` del resumen final: listos / con error / cancelados (FR-016)

### Implementation for User Story 2

- [ ] T030 [US2] Implementar el watchdog por archivo en `src/components/FileQueue.tsx`: un `AbortController` por archivo encadenado al del lote, con temporizador que se reinicia con cada evento de progreso; 300 s por defecto y 900 s para audio/video (contracts/reliability.md §Watchdog)
- [ ] T031 [US2] Consumir `classifyError`/`makeRowError` desde `src/lib/error-class.ts` en `src/components/FileQueue.tsx` y guardar `errorClass` en `BatchItem` (data-model.md §BatchItem)
- [ ] T032 [US2] Agregar la acción "Reintentar" en las filas con error transitorio en `src/components/FileQueue.tsx`, que vuelve a leer el `File` original y reencola sólo esa fila
- [ ] T033 [US2] Extender el resumen consolidado del lote con la cuenta de cancelados en `src/components/FileQueue.tsx` y en `src/ui/a11y/LiveRegion.tsx`, manteniendo un solo sonido por lote

**Checkpoint**: un lote con archivos rotos entrega todo lo demás y explica cada fallo.

---

## Phase 5: User Story 3 - Pausar y reanudar (Priority: P2)

**Goal**: control del lote largo sin perder trabajo hecho.

**Independent Test**: arrancar un lote, pausar a mitad, verificar que no arranca nada nuevo,
reanudar y comprobar que termina completo.

### Tests for User Story 3

- [ ] T034 [P] [US3] Tests de `PauseGate` en `tests/lib/job-scheduler.test.ts`: pausar no arranca trabajos nuevos y los en vuelo terminan; reanudar sigue en orden; cancelar estando pausado funciona sin reanudar; `pause()`/`resume()` idempotentes; sin gate el comportamiento es idéntico al actual (contracts/job-scheduler.md)
- [ ] T035 [P] [US3] Verificar que los 6 tests existentes de `tests/lib/job-scheduler.test.ts` siguen pasando sin modificarse

### Implementation for User Story 3

- [ ] T036 [US3] Implementar `PauseGate` y su parámetro opcional en `runWithConcurrency`, en `src/lib/job-scheduler.ts`, consultado antes de tomar cada índice del cursor
- [ ] T037 [US3] Cablear pausa/reanudación en `src/components/FileQueue.tsx` y agregar el estado `'paused'` a `BatchItem`
- [ ] T038 [US3] Agregar los controles Pausar/Reanudar junto a "Cancelar lote" en `src/components/FileQueue.tsx`, operables por teclado, con `aria-label` que refleje el estado
- [ ] T039 [US3] Agregar el ícono de pausa en `src/ui/components/icons.tsx` y el estilo del estado `paused` en `src/index.css`, con diferenciador no cromático (ícono + texto) y contraste AA (FR-021, Principio XII)

**Checkpoint**: las tres historias funcionan de forma independiente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T040 [P] Extraer la fila de la cola a un componente memoizado y mover `choicesFor` a un `useMemo` por entrada, en `src/components/FileQueue.tsx` (FR-022)
- [ ] T041 [P] Throttlear las actualizaciones de progreso acumulando en un ref y volcando con `requestAnimationFrame`, en `src/components/FileQueue.tsx` (FR-023)
- [ ] T042 [P] Test e2e en `tests/e2e/batch-large.spec.ts`: soltar una carpeta de 60 archivos, convertir, pausar a mitad, reanudar, descargar el ZIP y verificar la cantidad de entradas
- [ ] T043 [P] Actualizar `README.md` y `src/ui/README.md` con el tope nuevo de 200, la pausa/reanudación y el reintento
- [ ] T044 Verificar el presupuesto de bundle con `npm run test:budget` y confirmar que quitar `JSZip` del camino de escritura no aumentó el chunk inicial
- [ ] T045 Correr la validación completa de `quickstart.md`, incluida la medición de memoria con 200 archivos en DevTools (SC-009)
- [ ] T046 Correr `npm run ci` completo y dejarlo en verde

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup — **BLOQUEA todas las historias**
- **US1 (Phase 3)**: depende de Foundational
- **US2 (Phase 4)**: depende de Foundational. Independiente de US1
- **US3 (Phase 5)**: depende de Foundational. Independiente de US1 y US2
- **Polish (Phase 6)**: depende de las historias que se quieran incluir

### Conflictos de archivo a tener en cuenta

- `src/components/FileQueue.tsx` lo tocan casi todas las fases: **no paralelizar** tareas que lo modifiquen. Es la razón de que pocas tareas de implementación lleven `[P]`.
- `src/lib/job-scheduler.ts` lo tocan T025 (particionado, US1) y T036 (PauseGate, US3): hacerlos secuenciales.
- `src/lib/directory-input.ts` lo tocan T019–T022: secuenciales entre sí.

### Parallel Opportunities

- T001 y T002 en paralelo.
- Dentro de Foundational: T006, T007 y T008 en paralelo (archivos distintos); T003→T004→T005 secuenciales.
- Todos los tests de una historia marcados `[P]` se pueden escribir en paralelo.
- Con varias personas: una toma US1, otra US2, otra US3, una vez cerrada la fase Foundational.

---

## Parallel Example: User Story 1

```bash
# Los tests de US1 se pueden escribir todos juntos (archivos distintos):
T009  tests/lib/directory-input.test.ts   (cupo)
T012  tests/lib/zip.test.ts               (round-trip)
T013  tests/lib/zip.test.ts               (una lectura por vez)
```

---

## Implementation Strategy

### MVP (sólo US1)

1. Phase 1: Setup
2. Phase 2: Foundational — **crítica, bloquea todo**
3. Phase 3: US1
4. **PARAR Y VALIDAR**: carpeta de 60 archivos de punta a punta, con la medición de memoria
5. Ya es entregable: resuelve el pedido literal del usuario

### Entrega incremental

1. Setup + Foundational → base lista
2. + US1 → lote grande funcionando (**MVP**)
3. + US2 → el lote grande además es confiable
4. + US3 → el lote grande es controlable
5. + Polish → fluidez y documentación

---

## Notes

- `[P]` = archivos distintos, sin dependencias pendientes
- Verificar que cada test falla antes de implementar
- Commit por tarea, en español, sin trailer de co-autoría
- Las tareas T005/T006 arreglan un defecto **preexistente** (UI trabada al cancelar con resultados previos), no una regresión de esta feature
