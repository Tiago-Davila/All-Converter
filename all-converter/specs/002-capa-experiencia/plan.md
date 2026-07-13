# Implementation Plan: Capa de experiencia (UI visual, sonido y accesibilidad)

**Branch**: `develop` (feature dir `002-capa-experiencia`) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-capa-experiencia/spec.md`

## Summary

Capa de presentación sobre el núcleo funcional de 001: tema oscuro con fondo animado por
shader WebGL reactivo, sonido opcional y complementario, y accesibilidad WCAG AA no
negociable. **No contiene lógica de conversión**: consume el registry, los workers, los
estados y los límites de 001.

El enfoque técnico se apoya en tres decisiones verificadas en [research.md](./research.md):

1. **El contenido nunca se apoya directamente sobre el shader.** Va sobre una superficie
   (scrim) con opacidad ≥ 0.85, lo que vuelve el contraste **determinista e independiente del
   fotograma**. Sin esto, el requisito "AA en el peor fotograma" (FR-007/SC-002) es imposible
   de garantizar y de testear.
2. **El sonido se reduce a tres eventos obligatorios** (drop, rechazo, fin-de-cola), sin sonido
   por archivo. Esto elimina por construcción la avalancha de audio en lotes.
3. **La degradación es una matriz explícita** (WebGL × Web Audio × reduce-motion), no una serie
   de `if` dispersos: un único módulo de capacidades decide, y los componentes solo leen.

## Technical Context

**Language/Version**: TypeScript 5.x en modo estricto (sin `any` no justificado), React 19.

**Primary Dependencies**: React 19, Vite, Tailwind CSS v4. **Nuevas de esta feature**: ninguna
librería de terceros para el shader (WebGL2 crudo, ~150 líneas, sin three.js/ogl). Para audio,
un adaptador propio sobre Web Audio API; ver DEP-002 y la nota de dependencias abajo.

**Storage**: `localStorage`, una única clave `convertitodo:ui-prefs`. Solo preferencias de
interfaz. Nunca datos de archivos (Principio II).

**Testing**: Vitest + Testing Library (jsdom), como en 001. Contraste verificado por test
automatizado sobre los tokens, no a ojo.

**Target Platform**: Chrome, Firefox, Edge y Safari actuales. Degradación elegante sin WebGL y
sin Web Audio.

**Project Type**: SPA estática client-side, sin backend.

**Performance Goals**: shader a 60 fps objetivo; degrada a estático si el promedio cae bajo
**30 fps durante 2 s** (FR-004). El shader corre en su propio canvas y **nunca bloquea** la
interacción ni compite con los workers de conversión.

**Constraints**: bundle inicial < 200 KB gzip (Principio V; hoy en 67.7 KB, hay margen). Cero
peticiones de red en runtime: fuentes, audio y shaders locales (Principios II y XVI). COEP
`require-corp` ya rompe los recursos externos, lo que actúa como red de seguridad.

**Scale/Scope**: cola de hasta 10 archivos (001 FR-023). Una sola pantalla.

## Constitution Check

*GATE: debe pasar antes de Phase 0 y re-verificarse tras Phase 1.*

| Principio | Cómo lo satisface este plan | Estado |
|---|---|---|
| II — Privacidad absoluta | Sin red en runtime; `localStorage` solo con preferencias de UI | ✅ |
| III — Registry central | Los selectores de destino leen del registry de 001; la UI no duplica la matriz | ✅ |
| IV — Main thread libre | El shader usa rAF y se pausa; las conversiones siguen en los workers de 001 | ✅ |
| V — Carga diferida y bundle | Audio cargado diferido y solo si el sonido está habilitado; shader inline (~3 KB) | ✅ |
| VI — Magic bytes | No aplica (no se toca la detección) | ✅ |
| VII — TypeScript estricto | Todos los tipos nuevos en `data-model.md`, sin `any` | ✅ |
| VIII — Sin test no hay merge | Tests por módulo definidos abajo; contraste y no-solo-color automatizados | ✅ |
| XII — Accesibilidad | Scrim que garantiza AA; los 5 estados con ícono+texto; foco visible | ✅ |
| XIII — Sonido complementario | 3 eventos, todos con equivalente visual; silencio por defecto; veto de reduce-motion | ✅ |
| XIV — Rendimiento percibido | Pausa con `document.hidden`; degrada bajo 30 fps; scrim mantiene el texto legible | ✅ |
| XV — Honestidad de la interfaz | Tiles de borde que avisan **antes** de convertir; OCR visible pero inerte | ✅ |
| XVI — Sin telemetría | Audio y shader locales; test de "cero red en runtime" | ✅ |

**Violaciones**: ninguna. La sección Complexity Tracking queda vacía.

**Re-verificación post-Phase 1**: ✅ El diseño de `data-model.md` y los contratos no introduce
ninguna dependencia de red, ningún `any`, ni ningún estado comunicado solo por color.

## Project Structure

### Documentation (this feature)

```text
specs/002-capa-experiencia/
├── plan.md              # Este archivo
├── research.md          # Phase 0: decisiones técnicas verificadas
├── data-model.md        # Phase 1: tipos TS
├── quickstart.md        # Phase 1: validación manual
├── contracts/
│   ├── sound.md         # Contrato del SoundManager
│   ├── background.md    # Contrato del fondo animado
│   └── prefs.md         # Contrato de preferencias
├── checklists/
│   ├── requirements.md
│   └── ux.md
└── tasks.md             # Phase 2 (/speckit-tasks — NO lo crea este comando)
```

### Source Code (repository root)

```text
src/
├── ui/                          # NUEVO: toda la capa de experiencia
│   ├── background/
│   │   ├── ShaderBackground.tsx # Canvas + rAF + degradación a gradiente CSS
│   │   ├── shader.glsl.ts       # Fragment shader (FBM/noise) como string inline
│   │   └── intensity.ts         # Mapeo evento → intensidad objetivo (lógica pura, testeable)
│   ├── sound/
│   │   ├── SoundManager.ts      # playSound(event); enabled, veto RM, consolidación
│   │   ├── WebAudioAdapter.ts   # Adaptador: aísla la librería/API concreta
│   │   └── events.ts            # SoundEvent + mapeo evento → asset
│   ├── prefs/
│   │   └── ui-prefs.ts          # localStorage: leer/escribir/validar
│   ├── a11y/
│   │   ├── capabilities.ts      # Matriz: WebGL × Web Audio × reduce-motion
│   │   ├── tokens.ts            # Tokens de color (fuente de verdad del contraste)
│   │   └── LiveRegion.tsx       # aria-live consolidado por lote
│   └── components/
│       ├── Header.tsx           # Logo + sello de privacidad
│       ├── SoundToggle.tsx      # Control de sonido (muestra el efecto real, FR-034b)
│       ├── FileRow.tsx          # Los 5 estados: color + ícono + texto
│       ├── FormatSelect.tsx     # Selector de destino POR ARCHIVO (001 FR-023b)
│       ├── ZipBar.tsx
│       └── tiles/               # Estados de borde (avisos previos)
│           ├── PasswordPrompt.tsx
│           ├── SizeLimitTile.tsx
│           ├── UnsupportedTile.tsx
│           ├── ScannedPdfTile.tsx     # OCR visible pero inerte
│           ├── NoAudioTile.tsx
│           ├── PartialFidelityNote.tsx
│           └── Mp3CoverPicker.tsx     # Waveform por defecto (FR-028)
└── assets/sounds/               # DEP-002: assets locales (pendientes)

tests/ui/                        # Espeja src/ui/
```

**Structure Decision**: se agrega un único árbol nuevo `src/ui/`, separado de
`src/converters/`, `src/lib/` y `src/workers/` de 001. La regla de frontera es simple y
verificable: **nada dentro de `src/ui/` importa de `src/converters/` salvo `registry.ts` y
`types.ts`**, y ningún módulo de 001 importa de `src/ui/`. Los componentes existentes
(`FileQueue`, `Dropzone`, `ConversionCard`) se migran progresivamente a `src/ui/components/`.

## Nota de dependencias (decisión, no omisión)

**No se agrega ninguna librería nueva.** El argumento del comando mencionaba "la librería de
sonidos provista", pero (a) no existe tal librería en el repositorio y (b) el Principio de
dependencias exige justificarlas antes de agregarlas. Web Audio API alcanza para lo que la
spec pide (3 sonidos, volumen fijo, sin solapamiento), y `WebAudioAdapter` existe justamente
para que cambiar de opinión más adelante no toque ni los componentes ni el `SoundManager`.
Lo mismo con el shader: WebGL2 crudo, sin three.js (que costaría ~150 KB gzip y comería el
presupuesto entero del Principio V).

## Corrección de alcance respecto del argumento del comando

El argumento pedía un `FolderGroup` con **"selector de formato único"** por grupo. Eso quedó
**obsoleto**: la clarificación del 2026-07-13 estableció destino **por archivo** (spec 002
FR-011 enmendado, spec 001 FR-023b), y ya está implementado así en `FileQueue.tsx`
(tareas T047–T051, mergeadas). El plan documenta `FormatSelect` **por fila**. Planificar el
selector por grupo habría contradicho el código que ya existe.

## Fases de entrega (para /speckit-tasks)

El orden sigue las prioridades de la spec, que no son arbitrarias: lo no negociable primero.

| Fase | Contenido | Historia | Depende de |
|---|---|---|---|
| A | Tokens + capacidades + scrim + foco visible | US1 (P1) | — |
| B | FileRow con los 5 estados (color+ícono+texto), FormatSelect, LiveRegion | US1 (P1) | A |
| C | Tiles de borde + OCR inerte + waveform MP3→MP4 | US2 (P1) | B |
| D | Preferencias + SoundToggle (sin audio todavía) | US4 (P3) | A |
| E | Fondo shader + intensidad + degradación | US3 (P2) | A, **DEP-001** |
| F | SoundManager + adaptador + assets | US4 (P3) | D, **DEP-002** |

**A–D no dependen de ningún entregable pendiente** y pueden empezar ya. **E** está bloqueada
por el mockup (DEP-001) y **F** por los assets de audio (DEP-002).

## Complexity Tracking

Sin violaciones de la Constitución. Tabla vacía a propósito.
