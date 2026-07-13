# Data Model: Capa de experiencia (Phase 1)

Tipos TypeScript de la capa de experiencia. **No redefine ningún tipo de 001**: `FileEntry`,
`DetectedFileType`, `QueueState` y `Converter` se importan de `src/converters/types.ts`.

---

## Estados visuales de archivo

001 define `QueueState` con 8 valores; la spec 002 exige **5 estados visuales**. Este mapeo es
la traducción, y es explícito para que no quede ambiguo qué se muestra ante cada estado interno.

```ts
// src/ui/components/FileRow.tsx
export type VisualState = 'pending' | 'prep' | 'converting' | 'done' | 'error'

/** Traduce los 8 estados internos de 001 a los 5 estados visibles de 002. */
export function toVisualState(state: QueueState): VisualState | 'hidden'
// 'detecting' | 'ready' | 'queued' → 'pending'
// 'converting'                     → 'converting' | 'prep'  (según engineReady)
// 'completed'                      → 'done'
// 'error' | 'cancelled'            → 'error'
// 'rejected'                       → 'hidden'  (va a un tile de borde, no a la cola)
```

**Nota de diseño**: `cancelled` se mapea a `error` con una causa propia ("cancelado por vos") y
**es reintentable** (es un error transitorio, FR-019b). Esto cierra el hueco que el checklist
marcó en CHK010.

Cada estado visual tiene los **tres canales** obligatorios (FR-015), nunca solo color:

```ts
export interface StateDescriptor {
  readonly state: VisualState
  readonly label: string        // texto visible, p. ej. "Convirtiendo"
  readonly icon: IconName       // forma distinta, no solo color
  readonly colorToken: ColorToken
  readonly actions: readonly RowAction[]
}

export type RowAction = 'remove' | 'cancel' | 'download' | 'retry'
export type IconName = 'clock' | 'hourglass' | 'spinner' | 'check' | 'alert'
```

| Estado | Ícono | Texto | Acciones |
|---|---|---|---|
| `pending` | `clock` | "En cola" | `remove` |
| `prep` | `hourglass` | "Esperando al conversor…" | `cancel` |
| `converting` | `spinner` | "Convirtiendo N%" | `cancel` |
| `done` | `check` | "Listo" | `download` |
| `error` | `alert` | Causa concreta | `remove` + `retry` **solo si es transitorio** |

---

## Clase de error (decide si se puede reintentar)

```ts
/** FR-019b/c: reintentar solo tiene sentido ante fallos transitorios. */
export type ErrorClass = 'transient' | 'deterministic'

export interface RowError {
  readonly message: string      // causa concreta, nunca genérica
  readonly errorClass: ErrorClass
}
```

- `transient` (ofrece "Reintentar"): memoria insuficiente, fallo del motor, cancelación previa.
- `deterministic` (solo "Quitar"): archivo corrupto, tipo no soportado, tamaño excedido, PDF
  escaneado sin texto. Reintentar daría el mismo error: ofrecerlo sería mentir.

---

## Sonido

```ts
// src/ui/sound/events.ts
/** Los 4 obligatorios. NO existe evento por archivo (FR-029b). */
export type SoundEvent =
  | 'drop'                // un gesto de soltar con ≥1 aceptado
  | 'reject'              // un gesto de soltar con ≥1 rechazo
  | 'queue-done-ok'       // la cola terminó, sin errores
  | 'queue-done-errors'   // la cola terminó, con ≥1 error
  | 'hover'               // opcional
  | 'download'            // opcional
  | 'zip'                 // opcional

export interface SoundManager {
  /** No suena si: está silenciado, reduce-motion vetea, no hay Web Audio,
   *  aún no hubo gesto del usuario, u otro sonido está sonando (FR-035). */
  play(event: SoundEvent): void
  /** Estado efectivo, no la preferencia guardada (FR-034b). */
  isAudible(): boolean
  /** Motivo por el que no suena, para mostrarlo en el control. */
  silenceReason(): SilenceReason | undefined
}

export type SilenceReason = 'muted-by-user' | 'reduced-motion' | 'unsupported' | 'locked'
```

**`SoundAdapter`** aísla la API concreta (FR-038). Cambiar de Web Audio a otra librería toca
solo este archivo:

```ts
// src/ui/sound/WebAudioAdapter.ts
export interface SoundAdapter {
  unlock(): Promise<void>            // primer gesto del usuario
  preload(events: readonly SoundEvent[]): Promise<void>
  playOnce(event: SoundEvent, volume: number): void
  isBusy(): boolean                  // hay un sonido sonando → descartar el nuevo
}
```

---

## Preferencias de UI

```ts
// src/ui/prefs/ui-prefs.ts
export const PREFS_KEY = 'convertitodo:ui-prefs'

/** Lo ÚNICO que se persiste. Nunca datos de archivos (Principio II, FR-046). */
export interface UiPrefs {
  readonly soundEnabled: boolean     // default: false (silencio por defecto, FR-031)
}

export const DEFAULT_PREFS: UiPrefs = { soundEnabled: false }

/** Ante valor ausente, corrupto, ilegible o localStorage no disponible
 *  (modo privado, cuota llena) → DEFAULT_PREFS, sin error visible (FR-032b). */
export function readPrefs(): UiPrefs
export function writePrefs(prefs: UiPrefs): void
```

**No incluye** un override de reduce-motion: se respeta la preferencia del sistema y no se ofrece
anularla (decidido en la clarificación). El argumento del comando lo mencionaba; se descarta a
propósito para no multiplicar controles ni persistir estado que nadie puede cambiar.

---

## Fondo animado

```ts
// src/ui/background/intensity.ts  (lógica pura, sin WebGL → testeable con Vitest)
export type BackgroundActivity = 'idle' | 'hover' | 'drag-over' | 'converting'

export interface BackgroundState {
  readonly activity: BackgroundActivity
  readonly intensity: number          // 0..1, valor actual (interpolado)
  readonly targetIntensity: number    // 0..1, hacia dónde va
  readonly focus: readonly [number, number]  // punto de brillo, 0..1 en cada eje
  readonly progress?: number          // 0..1, si activity === 'converting'
}

/** Mapeo evento → intensidad objetivo. Función pura: el corazón testeable del fondo. */
export function targetFor(activity: BackgroundActivity, progress?: number): number
// idle       → 0.25
// hover      → 0.78
// drag-over  → 1.00
// converting → 0.40 + 0.45 * progress
```

```ts
// src/ui/background/ShaderBackground.tsx
export type BackgroundMode = 'shader' | 'static'

export interface ShaderUniforms {
  u_res: readonly [number, number]
  u_time: number
  u_int: number                        // intensity
  u_focus: readonly [number, number]
  u_warm: number                       // mezcla cálido/violáceo
}
```

**`u_mono` se descarta.** El argumento lo proponía para desaturar bajo reduce-motion, pero bajo
reduce-motion **no hay shader**: se degrada al gradiente CSS (D6). Un uniform que nunca se usa es
código muerto.

---

## Capacidades y degradación

```ts
// src/ui/a11y/capabilities.ts
export interface Capabilities {
  readonly webgl: boolean
  readonly webAudio: boolean
  readonly reducedMotion: boolean      // se re-evalúa si cambia en caliente
}

export interface DegradationPlan {
  readonly background: BackgroundMode  // 'static' si !webgl || reducedMotion
  readonly soundAllowed: boolean       // false si !webAudio || reducedMotion
}

export function planFor(caps: Capabilities): DegradationPlan
```

Un único lugar decide; los componentes solo leen (D6).

---

## Anuncios accesibles

```ts
// src/ui/a11y/LiveRegion.tsx
/** aria-live="polite". SIEMPRE consolidado por lote, nunca por archivo (FR-043). */
export interface Announcement {
  readonly done: number
  readonly failed: number
}

export function announcementText(a: Announcement): string
// { done: 7, failed: 3 } → "7 archivos listos, 3 con error"
```

La causa concreta de cada error **no** va en el anuncio (saturaría); se expone al enfocar la fila
(FR-043b).

---

## Props de los tiles de borde

Todos los tiles avisan **antes** de convertir (FR-027).

```ts
export interface PasswordPromptProps { entry: FileEntry; onUnlock(password: string): void; onRemove(): void }
export interface SizeLimitTileProps { entry: FileEntry; sizeBytes: number; maxSizeMB: number; onRemove(): void }
export interface UnsupportedTileProps { entry: FileEntry; acceptedFormats: readonly string[]; onRemove(): void }
export interface ScannedPdfTileProps { entry: FileEntry; onRemove(): void }   // OCR visible pero INERTE
export interface NoAudioTileProps { entry: FileEntry; videoTargets: readonly string[]; onChooseTarget(t: string): void; onRemove(): void }
export interface PartialFidelityNoteProps { converterId: string }             // aviso previo DOCX↔PDF
export interface Mp3CoverPickerProps { entry: FileEntry; cover: CoverChoice; onChange(c: CoverChoice): void }

/** FR-028: waveform por defecto ⇒ "Convertir" NUNCA se bloquea. */
export type CoverChoice = { kind: 'waveform' } | { kind: 'image'; file: File }
export const DEFAULT_COVER: CoverChoice = { kind: 'waveform' }
```

`ScannedPdfTile` no recibe `onOcr`: **el control de OCR no tiene handler**. Es visible, está
rotulado exactamente **"OCR (próximamente)"**, lleva `aria-disabled` y no ejecuta nada (FR-024).
Un handler que no hace nada invitaría a que alguien lo conecte por error.

---

## Selector de destino (por archivo)

```ts
// src/ui/components/FormatSelect.tsx
/** 001 FR-023b: el destino es POR ARCHIVO, no por grupo ni por lote. */
export interface FormatSelectProps {
  entry: FileEntry
  value: string | undefined            // undefined ⇒ "sin elegir": no se convierte (FR-023c)
  onChange(choiceKey: string): void
  disabled?: boolean
}
```

Las opciones salen de `getAvailableConverters(entry.detectedType)` + `getConverterTargets(...)`
del registry de 001. La UI **no** duplica la matriz de conversiones (Principio III).

---

## Tokens de color

```ts
// src/ui/a11y/tokens.ts — fuente de verdad del contraste; el test lee de acá
export type ColorToken = 'text-primary' | 'text-secondary' | 'text-muted'
  | 'accent-violet' | 'accent-warm'
  | 'state-pending' | 'state-prep' | 'state-converting' | 'state-done' | 'state-error'
  | 'focus-ring'

export const SURFACE = '#161521'   // scrim α=0.85 sobre el peor pico del shader (research D1)
export const TOKENS: Readonly<Record<ColorToken, string>>
```

El test de contraste (Fase A) itera `TOKENS` contra `SURFACE` y falla si algún par baja de 4.5
(o de 3.0 para `focus-ring`). Agregar un token que no cumple **rompe el build**, que es
exactamente lo que el Principio XII pide.
