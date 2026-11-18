# Implementation Plan: Lotes grandes y confiables

**Branch**: `006-lotes-grandes` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-lotes-grandes/spec.md`

## Summary

Subir el techo de la cola de 10 a **200 archivos** y hacer que un lote de ese tamaño no se
caiga: aislamiento de fallos con reintento sólo en errores transitorios, watchdog por archivo,
pausa/reanudación, y un empaquetado ZIP que lee un resultado por vez en lugar de sostenerlos
todos en memoria.

El enfoque técnico se apoya en tres cambios de fondo, en este orden:

1. **Memoria**: los resultados se retienen como `Blob` (respaldado en disco) en vez de
   `ArrayBuffer` (heap), eliminando una copia completa de las salidas.
2. **Empaquetado**: un generador ZIP incremental propio, método STORE, que lee un `Blob` por
   vez y emite chunks. **No** `JSZip.generateAsync` — ver la corrección de rumbo abajo.
3. **Planificación**: pausa cooperativa y particionado de la concurrencia, ambos concentrados
   en `src/lib/job-scheduler.ts` para no tocar ningún conversor.

### Corrección de rumbo respecto de la hipótesis inicial

El plan de partida asumía que *"JSZip acepta `Blob` y lo lee perezosamente al generar"*. Se
midió y **es falsa**: JSZip 3.10.1 lee cada blob en el acto, al llamar `zip.file()`, y retiene
los bytes hasta el `generate`. El pico de memoria sería la suma de todas las salidas —
exactamente lo que la feature busca evitar. Peor todavía, JSZip sólo sabe leer un `Blob` si
existe `FileReader`, que en Node es `undefined`, y `vitest.config.ts:8` corre con
`environment: 'node'`: el camino habría roto la suite de tests además de la memoria.

De ahí sale la decisión D1 de `research.md`: escritor STORE propio, ya prototipado y validado
releyendo la salida con `JSZip.loadAsync` (52 entradas, fidelidad de bytes, acentos y
subcarpetas correctos). La decisión de usar `Blob` para *retener resultados* (D2) sobrevive
intacta; era independiente.

## Technical Context

**Language/Version**: TypeScript estricto (sin `any` no justificado), React 19

**Primary Dependencies**: Vite, JSZip 3.10.1 *(sólo para leer/verificar en tests; el
empaquetado pasa a ser propio)*, pdfjs-dist, SheetJS, mammoth, ffmpeg.wasm — todas ya presentes

**Storage**: N/A — sin backend. Persistencia efímera en memoria y `Blob` respaldado por el
navegador; preferencias en `localStorage`

**Testing**: Vitest con `environment: 'node'`; Playwright para e2e

**Target Platform**: navegadores de escritorio modernos; audio/video no disponible en móviles

**Project Type**: aplicación web client-side de una sola página, sin servidor

**Performance Goals**: lote de 200 archivos de punta a punta; UI responde a un clic en <1 s
durante la conversión; 5000 archivos soltados producen respuesta en <5 s

**Constraints**: cero red en runtime; bundle inicial <200 KB gzip; pico de memoria del orden
del archivo más grande, no de la suma del lote; sin dependencias nuevas

**Scale/Scope**: 200 archivos en cola; ~8 archivos fuente tocados; sin conversores nuevos

## Constitution Check

*GATE: revisado antes de Phase 0 y re-verificado tras el diseño de Phase 1.*

| Principio | Estado | Cómo lo cumple |
|---|---|---|
| I — La especificación manda | ✅ | Todo el trabajo se traza a FR-001…FR-023. La discrepancia con el tope de 10 de specs 001/002 está declarada en spec.md §Contexto y frontera |
| II — Privacidad absoluta | ✅ | Ningún cambio toca la red. El ZIP se arma en el navegador; `showSaveFilePicker` escribe al disco local del usuario |
| III — Converter única y registry | ✅ | No se agrega ni modifica ningún conversor. La firma `Converter.convert` no cambia; el watchdog vive fuera, encadenando `AbortSignal` |
| IV — Web Workers obligatorios | ✅ | El empaquetado sigue en `zip.worker.ts`. Los chunks se postean con transferables |
| V — Carga diferida y bundle | ✅ | El escritor STORE son ~150 líneas dentro del worker, no en el bundle inicial. JSZip deja de necesitarse para escribir, lo que **reduce** peso. Verificado por `test:budget` |
| VI — Magic bytes | ✅ | `detectFileType` se conserva; sólo cambia **cuándo** se llama (después del cupo, no antes) |
| VII — TypeScript estricto | ✅ | Sin `any`. El escritor binario usa `Uint8Array`/`DataView` tipados |
| VIII — Sin test no hay merge | ✅ | Round-trip del ZIP contra `JSZip.loadAsync`, tests de PauseGate, watchdog e ingreso; fixtures reales |
| IX / XV — Honestidad en la UI | ✅ | Reintento **sólo** en errores transitorios; el desborde de 4 GB se avisa antes en vez de fallar después; los rechazos por cupo dicen cantidad y motivo |
| X — Memoria y límites | ✅ | Es el corazón de la feature. `maxSizeMB` por conversor se conserva sin cambios |
| XI — Sin código fuera de fase | ⚠️ | Se escribieron dos spikes de verificación **fuera del repositorio** (scratchpad de sesión), no código de producto. Ver Complexity Tracking |
| XII — Accesibilidad | ✅ | `paused` lleva ícono + texto, no sólo color; Pausar/Reanudar/Cancelar operables por teclado con foco visible |
| XIII — Sonido complementario | ✅ | Se mantiene un solo sonido por lote. El estado pausado no agrega sonido nuevo |
| XIV — Rendimiento percibido | ✅ | El throttling del progreso mejora la fluidez del fondo animado durante lotes grandes |
| XVI — Sin telemetría | ✅ | Ningún origen externo nuevo |

**Puertas de merge**: (1) trazabilidad ✅ (2) test con fixture real ✅ (3) TS estricto ✅
(4) tamaño de chunks ✅ (5) contraste AA y estado no cromático ✅ (6) sonido con equivalente
visual ✅ (7) sin origen externo ✅.

**Veredicto**: pasa. La única observación (XI) se justifica abajo.

## Project Structure

### Documentation (this feature)

```text
specs/006-lotes-grandes/
├── plan.md              # Este archivo
├── spec.md              # Qué y por qué
├── research.md          # D1–D8, con las mediciones
├── data-model.md        # Cambios de entidades y transiciones de estado
├── quickstart.md        # Guía de validación
├── checklists/
│   └── requirements.md
├── contracts/
│   ├── zip-stream.md    # Empaquetado incremental
│   ├── job-scheduler.md # PauseGate y particionado
│   └── reliability.md   # Watchdog, clasificación, reintento
└── tasks.md             # Lo genera /speckit-tasks
```

### Source Code (repository root)

```text
all-converter/
├── src/
│   ├── App.tsx                        # MOD: serializar aportes de archivos (FR-005)
│   ├── components/
│   │   └── FileQueue.tsx              # MOD: el grueso — Blob, pausa, reintento,
│   │                                  #      watchdog, resumen, try/finally del ZIP
│   ├── lib/
│   │   ├── directory-input.ts         # MOD: 200, techo de scan, cupo antes de detectar
│   │   ├── job-scheduler.ts           # MOD: PauseGate + particionado
│   │   ├── zip.ts                     # MOD: entradas Blob, sink de chunks
│   │   ├── zip-paths.ts               # SIN CAMBIOS
│   │   └── error-class.ts             # NUEVO: movido desde ui/components/
│   ├── ui/components/
│   │   ├── error-class.ts             # MOD: reexporta desde lib/ (compatibilidad)
│   │   └── icons.tsx                  # MOD: ícono de pausa
│   └── workers/
│       ├── types.ts                   # MOD: respuesta 'chunk'
│       ├── client.ts                  # MOD: callback onChunk opcional
│       ├── zip-operations.ts          # MOD: escritor STORE incremental
│       └── zip.worker.ts              # MOD: emitir chunks
└── tests/
    ├── lib/{directory-input,job-scheduler,zip}.test.ts   # MOD + casos nuevos
    ├── components/batch-flow.test.tsx                     # MOD + casos nuevos
    └── e2e/batch-large.spec.ts                            # NUEVO
```

**Structure Decision**: se conserva la estructura existente. No se crean capas ni directorios
nuevos. `src/components/FileQueue.tsx` concentra la mayor parte del cambio porque es donde vive
la orquestación del lote; el resto son extensiones puntuales de módulos que ya existen. El
único archivo verdaderamente nuevo en `src/` es el movimiento de `error-class.ts` a `lib/`,
que reconoce que dejó de ser presentación.

## Orden de implementación

Las dependencias mandan el orden: la memoria habilita todo lo demás, y el tope se sube **último
dentro del núcleo**, cuando la infraestructura ya lo aguanta.

| Tramo | Contenido | Depende de |
|---|---|---|
| **A** | Resultados como `Blob`; `try/finally` del ZIP; filtro O(n²) → `Set` | — |
| **B** | Escritor STORE incremental; canal de chunks; sink de descarga | A |
| **C** | Tope 200; techo de exploración; cupo antes de detectar; serializar aportes; fila resumen | A, B |
| **D** | PauseGate; particionado; watchdog; `error-class` en la cola viva; reintento; resumen de lote | A |
| **E** | Fila memoizada; progreso throttleado; estado `paused` accesible | D |

Una tarea, un diff, un commit; conventional commits en español, sin trailer de co-autoría.

## Complexity Tracking

| Violación | Por qué hace falta | Alternativa más simple, y por qué se rechazó |
|---|---|---|
| **Principio XI** — se ejecutó código de verificación durante la fase de planificación | La decisión D1 dependía de una propiedad de JSZip que resultó ser la contraria de lo asumido. Sin medirla, el plan habría entrado a implementación con una premisa falsa y el defecto habría aparecido recién con 200 archivos en producción | Aceptar la premisa y verificar en la fase de implementación. Se rechazó porque el costo de descubrirlo tarde es rehacer el tramo B entero, y el principio busca evitar que el código condicione la spec — no prohibir medir una dependencia. Los spikes viven **fuera del repositorio** y no aportan una línea al producto |
| **Escritor ZIP propio** en vez de una librería | JSZip no puede empaquetar sin materializar todo (medido). Escribir STORE son ~150 líneas de un formato estable y documentado, ya prototipado y validado por round-trip | `fflate` da streaming real y sería una opción legítima, pero las Restricciones Técnicas exigen justificar toda dependencia nueva antes de sumarla. Queda como plan B explícito si el escritor propio se complica |
| **Sin ZIP64** | Implementarlo amplía bastante la superficie de un componente binario delicado, para un caso (>4 GB en un lote) que sólo se alcanza con video | Implementar ZIP64 desde el vamos. Se rechazó por costo/beneficio: detectar el desborde y avisar es honesto (Principio XV), barato y deja la descarga individual funcionando |
