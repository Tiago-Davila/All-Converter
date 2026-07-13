/**
 * events.ts: definición de los 4 eventos de sonido obligatorios y su tabla
 * de equivalentes visuales (T033, FR-029, FR-033, research §D3).
 *
 * Regla dura: todo SoundEvent DEBE tener equivalente visual declarado.
 * Si una fila no tiene equivalente visual, el evento no puede existir.
 * El test verifica esta invariante automáticamente (invariante 2 del contrato).
 */

/** Los 4 eventos obligatorios + opcionales permitidos. */
export type SoundEvent =
  | 'drop'
  | 'reject'
  | 'queue-done-ok'
  | 'queue-done-errors'
  | 'hover'
  | 'download'
  | 'zip'

/** Descripción del equivalente visual obligatorio de un evento de sonido. */
export interface SoundEventEntry {
  event: SoundEvent
  /** Cuándo se dispara (documentación). */
  when: string
  /** Descripción del equivalente visual obligatorio (FR-033). */
  visualEquivalent: string
  /** Nombre del asset de audio (sin extensión). null = evento opcional sin asset todavía. */
  asset: string | null
}

/**
 * Tabla canónica evento → equivalente visual → asset.
 * Fuente de verdad: research.md §D3.
 * Los 4 primeros son OBLIGATORIOS. Los tres últimos son opcionales.
 */
export const SOUND_EVENTS: readonly SoundEventEntry[] = [
  {
    event: 'drop',
    when: 'Un gesto de soltar con ≥1 archivo aceptado. Uno por gesto, no por archivo.',
    visualEquivalent: 'Las filas aparecen en la cola; el dropzone colapsa a tira.',
    asset: 'drop',
  },
  {
    event: 'reject',
    when: 'Un gesto de soltar que produjo ≥1 rechazo. Uno por gesto.',
    visualEquivalent: 'Tile de rechazo con el motivo concreto.',
    asset: 'reject',
  },
  {
    event: 'queue-done-ok',
    when: 'La cola queda sin nada en converting/prep, sin errores.',
    visualEquivalent: 'Todas las filas en done; aparece la ZipBar.',
    asset: 'done-ok',
  },
  {
    event: 'queue-done-errors',
    when: 'La cola queda sin nada en converting/prep, con ≥1 error.',
    visualEquivalent: 'Filas en done + filas en error con su causa.',
    asset: 'done-errors',
  },
  // Opcionales (sin asset por ahora)
  {
    event: 'hover',
    when: 'Hover en el dropzone.',
    visualEquivalent: 'Cambio de estado visual del dropzone.',
    asset: null,
  },
  {
    event: 'download',
    when: 'El usuario descarga un archivo convertido.',
    visualEquivalent: 'Cambio de estado del botón de descarga.',
    asset: null,
  },
  {
    event: 'zip',
    when: 'Se genera el ZIP de la cola.',
    visualEquivalent: 'Aparece la ZipBar con el enlace de descarga.',
    asset: null,
  },
] as const

/** Lookup rápido por nombre de evento. */
export function getSoundEntry(event: SoundEvent): SoundEventEntry | undefined {
  return SOUND_EVENTS.find((e) => e.event === event)
}

/** Los 4 eventos obligatorios (deben tener asset). */
export const REQUIRED_SOUND_EVENTS: readonly SoundEvent[] = [
  'drop',
  'reject',
  'queue-done-ok',
  'queue-done-errors',
] as const
