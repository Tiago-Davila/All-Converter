# Tasks: Redimensionador de imágenes

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

**Regla de ejecución**: una tarea, un diff, un commit convencional en español. Ninguna tarea
se cierra sin su test. `[P]` = paralelizable tras sus dependencias.

---

## Phase 1: Núcleo puro

- **T001** — `src/lib/image-resize.ts`: constantes `RESIZE_MIN` (32), `RESIZE_LONG` (1920),
  `RESIZE_SHORT` (1080) y funciones `isValidPair`, `maxForAxis`, `clampAxis`, `linkedPair`,
  `initialPair`. Sin DOM, sin React. (FR-005, FR-006, FR-007, FR-008)
- **T002** — `tests/lib/image-resize.test.ts`: paisaje 3000×2000 → 1920×1080; retrato
  2000×3000 → 1080×1920; cuadrado 2000×2000 → 1080×1080; proporción ±1 px; `clampAxis` no
  toca el otro eje; mínimo 32; aspecto extremo 4000×50 (el máximo gana sobre el mínimo);
  imagen chica no se agranda sola en `initialPair`. Depende de T001.

## Phase 2: Worker

- **T003** — `src/workers/validation.ts`: `validateImageResizeRequest` — operación, 1 input,
  **sin** whitelist de mime de entrada, salida en `['image/png','image/jpeg','image/webp']`,
  `width`/`height` enteros que cumplen `isValidPair`, `quality` opcional en (0,1]. (FR-007)
- **T004** — `src/workers/image.worker.ts`: despacho por `data.operation`. Rama
  `image-resize` con dimensiones exactas (permite agrandar) y sin rechazo de animados; rama
  `image-convert` **sin cambios de comportamiento**. Nombre de salida con dimensiones.
  (FR-008, FR-012, FR-013, FR-014). Depende de T003.
- **T005** — `src/converters/image-resize.ts`: `Converter` que arma el `WorkerStartRequest`
  y delega en `startWorker`. `maxSizeMB: 50`. Comentario de por qué no va al registry.
  Depende de T004.
- **T006 [P]** — Tests de worker: casos `image-resize` en `tests/workers/validation.test.ts`
  y evidencia en `tests/workers/worker-coverage.test.ts`. Depende de T003–T005.

## Phase 3: Navegación

- **T007** — `src/ui/routing.ts`: `useHashRoute(): 'home' | 'resize'`. (FR-015)
- **T008** — `src/App.tsx`: switch de vista. La cola sobrevive a ir y volver.
  Depende de T007 y T010.
- **T009 [P]** — Entradas: botón "Redimensionar imagen" en `.ct-hero-actions`
  (`src/ui/components/Dropzone.tsx`) y link en `src/ui/components/Header.tsx`. (FR-015)

## Phase 4: Página

- **T010** — `src/ui/components/ResizePage.tsx`: selección + drag&drop, `detectFileType`,
  vista previa con lectura de `naturalWidth/Height`, campos de ancho/alto, checkbox de
  proporción, selector de salida, calidad, avisos condicionales, descarga y revocado de
  object URLs. (FR-001 a FR-013). Depende de T001, T005.
- **T011 [P]** — `src/index.css`: bloque `.ct-resize-*` con los tokens `--ct-*` existentes.
  Depende de T010.
- **T012 [P]** — `tests/ui/components/resize-page.test.tsx` (jsdom): render vacío, límites al
  escribir, proporción on/off, aviso de fallback a PNG. Depende de T010.

## Phase 5: E2E y verificación

- **T013** — `tests/e2e/image-resize.spec.ts`: entrada por botón de portada y por URL
  directa; dimensiones originales visibles; proporción activa; proporción desactivada
  (500×500 exacto); tope 1920; mínimo 32; salida WebP con magic bytes. Depende de T008–T011.
- **T014** — Verificación completa: `npm run lint`, `npm run test`, `npm run build`,
  `npm run test:budget`, `npm run test:workers`, `npm run test:e2e`.
