# Tasks: Capa de experiencia (UI visual, sonido y accesibilidad)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md), [contracts/](./contracts/)

**Regla de ejecución**: una tarea, un diff, un commit convencional en español. Ninguna tarea de
componente se cierra sin su test. `[P]` significa paralelizable tras sus dependencias.

**Puertas de merge (Constitución)**: trazabilidad a una tarea · test con fixture/caso real ·
TypeScript estricto sin `any` · presupuesto de bundle en `npm run build` · contraste AA
verificado · todo evento sonoro con equivalente visual · cero red en runtime.

---

## Correcciones al argumento del comando (leer antes de ejecutar)

El argumento de `/speckit-tasks` describía cuatro cosas que **contradicen decisiones ya tomadas**
en la spec y en el código. Las tareas siguen la spec, no el argumento:

1. **"FolderGroup con selector de formato único"** → **descartado**. El destino se elige **por
   archivo** (002 FR-011 enmendado, 001 FR-023b), y ya está implementado así en `FileQueue.tsx`
   (T047–T051, mergeadas). Las tareas usan `FormatSelect` **por fila**.
2. **Eventos de sonido `CONVERT_START` / `CONVERT_DONE`** → **descartados**. FR-029b **prohíbe**
   el sonido por archivo: una cola de 10 archivos sonaría 10 veces. Los eventos obligatorios son
   **cuatro**: `drop`, `reject`, `queue-done-ok`, `queue-done-errors`.
3. **"reduce-motion override" en preferencias** → **descartado**. Se respeta la preferencia del
   sistema y no se ofrece anularla. Lo único que se persiste es `soundEnabled`.
4. **"Mp3ToMp4CoverPicker (bloquea Convertir)"** → **invertido**. FR-028: hay **waveform
   automático por defecto**, así que "Convertir" **nunca se bloquea**.

**OCR**: fuera de alcance. Se muestra **visible pero inerte**, rotulado exactamente
**"OCR (próximamente)"**, con `aria-disabled` y **sin handler**. Ninguna tarea implementa OCR.

---

## Dependencias externas que bloquean fases enteras

- **DEP-001 (mockup)**: no existe en el repo. **Bloquea la Fase 5** (fondo shader). Los tokens de
  la Fase 1 son provisionales pero **ya verificados AA** (research §D2); cuando llegue el mockup,
  T004 los re-verifica y **gana la accesibilidad** si algún color suyo falla.
- **DEP-002 (assets de audio)**: no existen. **Bloquea T019 y la Fase 6**. Se necesitan **4
  sonidos distinguibles**, no 3.

Las Fases 1–4 y 7–8 **no dependen de nada** y son el camino crítico.

---

## Phase 1: Setup visual y accesibilidad base

**Objetivo**: los cimientos que todo lo demás usa. Sin esto, ningún componente puede cumplir AA.

- [X] T001 Crear el árbol `src/ui/` (`background/`, `sound/`, `prefs/`, `a11y/`, `components/tiles/`) y su espejo en `tests/ui/`, con la regla de frontera documentada: nada en `src/ui/` importa de `src/converters/` salvo `registry.ts` y `types.ts`, y ningún módulo de 001 importa de `src/ui/`.
- [X] T002 Definir los tokens de color como fuente de verdad en `src/ui/a11y/tokens.ts`, exportando `TOKENS`, `SURFACE = '#161521'` y el tipo `ColorToken` según `data-model.md` (depende de T001).
- [X] T003 Implementar el cálculo de contraste WCAG 2.1 (luminancia relativa) en `src/ui/a11y/contrast.ts` con pruebas de casos conocidos en `tests/ui/a11y/contrast.test.ts` (depende de T001).
- [X] T004 **Puerta de accesibilidad**: test que itera todos los `TOKENS` contra `SURFACE` y **falla el build** si alguno baja de 4.5 (o de 3.0 en `focus-ring`), en `tests/ui/a11y/tokens.test.ts`. Agregar un token que no cumple debe romper la suite (depende de T002–T003).
- [X] T005 Implementar el scrim y los estilos base del tema oscuro (superficie α ≥ 0.85 sobre el fondo, radios, tipografías self-hosteadas ya presentes en `public/fonts/`) en `src/index.css` y `src/ui/a11y/surface.css`, sin ningún `@import` remoto (depende de T002).
- [X] T006 Implementar el foco visible global (anillo con `focus-ring`, contraste ≥ 3.0, nunca `outline: none` sin reemplazo) en `src/index.css`, con prueba de que ningún control queda sin indicador de foco en `tests/ui/a11y/focus.test.tsx` (depende de T002, T005).
- [X] T007 Implementar la matriz de capacidades y degradación (`Capabilities`, `DegradationPlan`, `planFor`) en `src/ui/a11y/capabilities.ts`, con pruebas de las 5 filas de la matriz (research §D6) en `tests/ui/a11y/capabilities.test.ts` (depende de T001).

**Checkpoint**: el contraste es una puerta automatizada y la degradación tiene un único dueño.

---

## Phase 2: Preferencias de UI (Foundational)

- [ ] T008 Implementar `readPrefs`/`writePrefs` sobre `localStorage` con la clave única `convertitodo:ui-prefs` y el default `{ soundEnabled: false }` en `src/ui/prefs/ui-prefs.ts` (depende de T001).
- [ ] T009 Pruebas de preferencias en `tests/ui/prefs/ui-prefs.test.ts`, cubriendo los 5 invariantes de `contracts/prefs.md`: default silencioso, JSON corrupto → default sin throw, `localStorage` que lanza → no propaga, round-trip, y **que lo persistido no contenga ninguna clave fuera de `soundEnabled`** (nunca datos de archivos) (depende de T008).

**Checkpoint**: la preferencia persiste y no filtra nada. La Fase 6 puede leerla.

---

## Phase 3: Los cinco estados de archivo — US1 (P1)

**Objetivo de la historia**: cada estado se entiende sin depender del color.

**Prueba independiente**: renderizar los 5 estados y verificar que cada uno tiene ícono + texto
propios, es alcanzable por teclado y expone su acción correcta. **Sin shader ni sonido.**

- [ ] T010 [US1] Implementar `toVisualState` (traduce los 8 estados de 001 a los 5 visibles) y la tabla `StateDescriptor` (ícono + texto + token + acciones) en `src/ui/components/state-map.ts`, mapeando `cancelled` → `error` **transitorio** (reintentable), con pruebas de los 8 estados de origen en `tests/ui/components/state-map.test.ts` (depende de T002).
- [ ] T011 [US1] Implementar la clasificación de errores (`ErrorClass`: `transient` vs `deterministic`) que decide si se ofrece "Reintentar" (FR-019b/c) en `src/ui/components/error-class.ts`, con pruebas de que corrupto/no-soportado/tamaño/PDF-escaneado **no** ofrecen reintento y memoria/motor/cancelación **sí**, en `tests/ui/components/error-class.test.ts` (depende de T010).
- [ ] T012 [US1] Implementar `FileRow` con los 5 estados (color **+ ícono + texto**), porcentaje real y barra determinística en `converting`, y las acciones por estado, en `src/ui/components/FileRow.tsx` (depende de T010–T011).
- [ ] T013 [US1] **Test de no-solo-color**: verificar que los 5 estados son distinguibles **sin usar el color** (cada uno con ícono y texto distintos) y que el nombre accesible de cada fila incluye su estado, en `tests/ui/components/FileRow.test.tsx` (depende de T012).
- [ ] T014 [US1] Implementar `FormatSelect` **por fila**, poblado desde `getAvailableConverters` + `getConverterTargets` del registry de 001, con `undefined` = "sin elegir" (no se convierte, no bloquea al resto), en `src/ui/components/FormatSelect.tsx` con pruebas de que solo ofrece destinos válidos para el tipo del archivo en `tests/ui/components/FormatSelect.test.tsx` (depende de T012).
- [ ] T015 [US1] Implementar `LiveRegion` (`aria-live="polite"`) con anuncios **siempre consolidados por lote** ("7 archivos listos, 3 con error"), nunca por archivo, en `src/ui/a11y/LiveRegion.tsx` y `announcementText`, con pruebas de que una cola de 10 produce **1** anuncio en `tests/ui/a11y/LiveRegion.test.tsx` (depende de T001).
- [ ] T016 [US1] Exponer la causa concreta de cada error al **enfocar** la fila (compensa el anuncio consolidado, FR-043b), en `src/ui/components/FileRow.tsx` con prueba de teclado en `tests/ui/components/FileRow.test.tsx` (depende de T013, T015).
- [ ] T017 [US1] Verificar por teclado que `Cancelar` es alcanzable **durante** una conversión y que el foco no queda huérfano al desaparecer una fila, en `tests/ui/components/keyboard-nav.test.tsx` (depende de T012, T016).

**Checkpoint**: US1 completa y demostrable. **Este es el MVP.**

---

## Phase 4: Estados de borde — US2 (P1)

**Objetivo**: toda limitación se comunica **antes** de convertir.

**Prueba independiente**: cargar los seis archivos problemáticos y ver que cada uno produce su
aviso específico y sus acciones, antes de que la conversión pueda empezar.

Los siete tiles son **[P] entre sí**: archivos distintos, sin dependencias cruzadas.

- [ ] T018 [P] [US2] Implementar `PasswordPrompt` (input de contraseña + nota de uso **solo local** + acciones Desbloquear/Quitar + camino de contraseña incorrecta) en `src/ui/components/tiles/PasswordPrompt.tsx` y `tests/ui/components/tiles/PasswordPrompt.test.tsx` (depende de T012).
- [ ] T019 [P] [US2] Implementar `SizeLimitTile` (muestra el **peso real** y el **máximo** de esa conversión; rechaza ANTES de convertir) en `src/ui/components/tiles/SizeLimitTile.tsx` y su test, leyendo `maxSizeMB` del registry de 001 (depende de T012).
- [ ] T020 [P] [US2] Implementar `UnsupportedTile` (enumera qué formatos **sí** se aceptan + acción Quitar) en `src/ui/components/tiles/UnsupportedTile.tsx` y su test. **"No soportados" es una vista agrupada de las entradas `rejected` de 001, NO un grupo convertible** (FR-012): sin selector de formato, sin acción de convertir, y **no cuenta para el tope de 10** archivos convertibles. Test que verifica las tres cosas (depende de T012).
- [ ] T021 [P] [US2] Implementar `ScannedPdfTile`: avisa que no hay texto que extraer y muestra el control **"OCR (próximamente)"** **visible pero inerte**, con `aria-disabled` y **sin handler**, en `src/ui/components/tiles/ScannedPdfTile.tsx`. Test que verifica que el rótulo es **exactamente** ese, que se anuncia como deshabilitado y que **activarlo no ejecuta nada**, en su test. **No se implementa OCR** (depende de T012).
- [ ] T022 [P] [US2] Implementar `NoAudioTile` (avisa que el video no tiene pista de audio y **ofrece convertirlo a otro formato de video** como alternativa) en `src/ui/components/tiles/NoAudioTile.tsx` y su test (depende de T012, T014).
- [ ] T023 [P] [US2] Implementar `PartialFidelityNote` (aviso previo "el formato puede variar levemente" en DOCX↔PDF, **antes** de convertir) en `src/ui/components/tiles/PartialFidelityNote.tsx` y su test (depende de T012).
- [ ] T024 [P] [US2] Implementar `Mp3CoverPicker` con **waveform generado por defecto** (`DEFAULT_COVER`), opción de reemplazarlo por una imagen y de volver al waveform. Test que verifica que **"Convertir" NUNCA queda bloqueado** (FR-028c) en `src/ui/components/tiles/Mp3CoverPicker.tsx` y su test (depende de T012).
- [ ] T025 [US2] Integrar los siete tiles en la cola, garantizando que el aviso aparece **antes** de que la conversión pueda iniciarse (FR-027), en `src/ui/components/FileQueue.tsx` con prueba de integración en `tests/ui/components/edge-cases.test.tsx` (depende de T018–T024).

**Checkpoint**: US2 completa. Con US1 + US2 la app ya es honesta y accesible, **sin fondo ni sonido**.

---

## Phase 5: Fondo animado — US3 (P2) — 🔒 BLOQUEADA POR DEP-001

**Objetivo**: identidad visual reactiva que nunca estorba.

**Prueba independiente**: verificar los modos de reacción, la degradación sin WebGL y que el
texto sigue legible.

- [ ] T026 [US3] Implementar el mapeo **puro** evento → intensidad objetivo (`targetFor`: idle 0.25, hover 0.78, drag-over 1.00, converting `0.40 + 0.45×progress`) en `src/ui/background/intensity.ts`, con pruebas sin WebGL en `tests/ui/background/intensity.test.ts` (depende de T007). **Esta tarea NO está bloqueada por DEP-001** y puede hacerse ya.
- [ ] T027 [US3] Escribir el fragment shader FBM/noise con los uniforms `u_res`, `u_time`, `u_int`, `u_focus`, `u_warm` (**sin `u_mono`**: bajo reduce-motion no hay shader) en `src/ui/background/shader.glsl.ts`, derivando la paleta del mockup (depende de **DEP-001**, T002).
- [ ] T028 [US3] Implementar `ShaderBackground`: canvas WebGL2 crudo (sin three.js), loop rAF que **interpola** la intensidad hacia el objetivo, `pointer-events: none`, resolución reducida (~0.75× DPR), en `src/ui/background/ShaderBackground.tsx` (depende de T026–T027).
- [ ] T029 [US3] Implementar el detector de bajo rendimiento: media móvil de FPS, degrada a estático si baja de **30 fps durante 2 s**, **descartando los primeros ~500 ms** de arranque, y **sin reintentar** en la sesión, en `src/ui/background/fps-guard.ts` con pruebas de reloj simulado en `tests/ui/background/fps-guard.test.ts` (depende de T028).
- [ ] T030 [US3] Implementar la degradación a **gradiente CSS** sin WebGL, ante `webglcontextlost`, y bajo `prefers-reduced-motion`, **sin ningún error visible**, en `src/ui/background/StaticBackground.tsx` y `ShaderBackground.tsx`, con pruebas en `tests/ui/background/degradation.test.tsx` (depende de T028, T007).
- [ ] T031 [US3] Implementar la pausa con `document.hidden` (cancela el rAF, reanuda al volver; pausar **no** es degradar) en `src/ui/background/ShaderBackground.tsx` con prueba en `tests/ui/background/visibility.test.tsx` (depende de T028).
- [ ] T032 [US3] Cablear la actividad del fondo a los eventos reales (hover, drag-over, progreso de conversión) en `src/App.tsx`, verificando que el fondo **no bloquea** la interacción durante una conversión (depende de T028–T031).

---

## Phase 6: Sonido — US4 (P3) — 🔒 T034+ BLOQUEADAS POR DEP-002

**Objetivo**: sonido opcional, sutil y siempre redundante.

**Prueba independiente**: los 4 eventos suenan distinto, cada uno tiene equivalente visual, una
cola de 10 archivos produce **1** sonido, y silenciado la app funciona idéntica pero muda.

- [ ] T033 [US4] Definir `SoundEvent` (**los 4 obligatorios**: `drop`, `reject`, `queue-done-ok`, `queue-done-errors`; opcionales: `hover`, `download`, `zip`) y la tabla evento → asset → **equivalente visual** en `src/ui/sound/events.ts`, con test de que **todo evento de la tabla tiene equivalente visual declarado** (research §D3) en `tests/ui/sound/events.test.ts` (depende de T001).
- [ ] T034 [US4] Implementar `WebAudioAdapter` (`unlock`, `preload`, `playOnce`, `isBusy`) aislando la API concreta, con desbloqueo perezoso del `AudioContext` en el **primer gesto** del usuario y **solo si el sonido está habilitado**, en `src/ui/sound/WebAudioAdapter.ts` y su test con Web Audio mockeado (depende de T033, **DEP-002**).
- [ ] T035 [US4] Implementar `SoundManager` (`play`, `isAudible`, `silenceReason`) en `src/ui/sound/SoundManager.ts`: silencio por defecto, **veto de reduce-motion**, sin sonido por archivo, un sonido por gesto de drop, **descarte** del disparo si otro sonido suena, y no-op mudo sin Web Audio (depende de T034, T008).
- [ ] T036 [US4] Pruebas del `SoundManager` cubriendo los **11 invariantes** de `contracts/sound.md` en `tests/ui/sound/SoundManager.test.ts`: no suena sin preferencia · no suena bajo reduce-motion **aunque esté habilitado** · cola de 10 → **1** sonido · soltar 10 archivos → **1** `drop` · segundo disparo mientras suena → descartado · sin Web Audio → no-op sin throw · **cola cancelada → sin sonido de éxito** · los 4 `silenceReason` · **cola dinámica → fin de cola espera a todos** (depende de T035).
- [ ] T037 [US4] Cablear los 4 eventos a sus disparadores reales y **verificar el equivalente visual de cada uno** (drop → filas aparecen; reject → tile con motivo; fin de cola → filas `done`/`error` + ZipBar) en `src/App.tsx` y `tests/ui/sound/wiring.test.tsx`. Incluir prueba de que **agregar archivos mientras la cola convierte pospone el disparo de `queue-done-ok/errors`** hasta que todos los archivos —incluyendo los recién agregados— terminen (FR-029c). Cubre FR-029, FR-033 (depende de T035, T025).
- [ ] T037b [US4] Verificar que el grupo **"No soportados" NO dispara ningún sonido de éxito**: una cola compuesta solo por archivos rechazados no emite `queue-done-ok` (no hubo conversión que celebrar), y un lote mixto solo cuenta los archivos realmente convertidos. Prueba en `tests/ui/sound/wiring.test.tsx`. Cubre **FR-036** (depende de T037).
- [ ] T038 [US4] Implementar `SoundToggle` que muestra el **efecto real** (no la preferencia guardada): bajo reduce-motion dice **"silenciado" con el motivo visible**, y la preferencia guardada **sobrevive intacta**, en `src/ui/components/SoundToggle.tsx` y su test (FR-034b/c) (depende de T035, T009).

---

## Phase 7: Estructura de pantalla y pulido

- [ ] T039 Implementar `Header` con logo y **sello de privacidad** visible ("Tus archivos nunca salen del navegador") en `src/ui/components/Header.tsx` y su test (depende de T005).
- [ ] T040 Implementar `Dropzone` protagonista en vacío que **colapsa a tira fina** con archivos en la cola, en `src/ui/components/Dropzone.tsx` y su test (depende de T005, T012).
- [ ] T041 Implementar `ZipBar` visible con **≥ 2 archivos listos** en `src/ui/components/ZipBar.tsx` y su test (depende de T012).
- [ ] T042 Migrar los componentes de 001 (`FileQueue`, `Dropzone`, `ConversionCard`, `ProgressBar`) a `src/ui/components/`, conservando su comportamiento y sus tests verdes (depende de T012, T040–T041).

---

## Phase 8: Puertas finales de calidad

- [ ] T043 **Test de cero red en runtime**: verificar que ningún asset (fuente, audio, shader) se carga desde un origen remoto y que no hay telemetría, en `tests/ui/no-network.test.ts` (Principios II y XVI, FR-045, SC-010) (depende de T034, T027).
- [ ] T044 Verificar el presupuesto de bundle con `npm run build`: el inicial debe seguir bajo **200 KB gzip** (hoy 67.7 KB), y el audio debe cargarse **diferido y solo si el sonido está habilitado** (Principio V) (depende de T034, T028).
- [ ] T045 Ejecutar y documentar la validación manual completa de [quickstart.md](./quickstart.md): los 12 escenarios, incluida la **matriz de degradación** (WebGL × Web Audio × reduce-motion) y la comprobación en escala de grises (depende de T032, T038, T042–T044).

---

## Dependencias y camino crítico

```
Fase 1 (T001–T007) ─┬─→ Fase 2 (T008–T009) ─→ T038
                    ├─→ Fase 3 US1 (T010–T017)  ← MVP
                    │        └─→ Fase 4 US2 (T018–T025)
                    │                └─→ T037
                    ├─→ T026 ──→ Fase 5 US3 (T027–T032)  🔒 DEP-001
                    └─→ T033 ──→ Fase 6 US4 (T034–T038)  🔒 DEP-002
                                        └─→ Fase 8 (T043–T045)
```

**Bloqueos reales**: T027–T032 esperan el **mockup**; T034–T038 esperan los **assets de audio**.
Todo lo demás (T001–T026, T033, T039–T042) se puede ejecutar hoy.

**Paralelizables**: los siete tiles de borde (T018–T024) entre sí; T026 y T033 con la Fase 3.

## Estrategia de entrega

**MVP = Fase 1 + Fase 3 (US1)**: la app con los cinco estados accesibles, contraste AA
verificado y navegación por teclado. Ya es una mejora entregable y demostrable **sin fondo
animado ni sonido**.

Después: US2 (bordes honestos) → US3 (fondo, cuando llegue el mockup) → US4 (sonido, cuando
lleguen los assets). El orden respeta las prioridades de la spec: lo no negociable primero, el
adorno al final.
