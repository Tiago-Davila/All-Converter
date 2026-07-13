/**
 * Traduce los 8 estados internos de 001 (QueueState) a los 5 estados visuales de 002.
 * data-model.md §Estados visuales de archivo.
 */
import type { QueueState } from '../../converters/types'
import type { ColorToken } from '../a11y/tokens'

export type VisualState = 'pending' | 'prep' | 'converting' | 'done' | 'error'
export type RowAction = 'remove' | 'cancel' | 'download' | 'retry'
export type IconName = 'clock' | 'hourglass' | 'spinner' | 'check' | 'alert'

export interface StateDescriptor {
  readonly state: VisualState
  readonly label: string
  readonly icon: IconName
  readonly colorToken: ColorToken
  readonly actions: readonly RowAction[]
}

/**
 * Traduce los 8 estados de QueueState a los 5 estados visuales (o 'hidden' para rejected).
 *
 * Regla especial: `cancelled` → `error` transitorio ("cancelado por vos"), reintentable
 * (spec FR-015, clarificación 2026-07-14).
 *
 * `engineReady` distingue `converting` de `prep`: si el motor aún no terminó de cargar,
 * el estado es `prep` aunque la entrada interna diga `converting`.
 */
export function toVisualState(
  state: QueueState,
  engineReady = true,
): VisualState | 'hidden' {
  switch (state) {
    case 'detecting':
    case 'ready':
    case 'queued':
      return 'pending'
    case 'converting':
      return engineReady ? 'converting' : 'prep'
    case 'completed':
      return 'done'
    case 'error':
    case 'cancelled':
      return 'error'
    case 'rejected':
      return 'hidden'
  }
}

/** Tabla estática de descriptores por estado visual. */
export const STATE_DESCRIPTORS: Readonly<Record<VisualState, StateDescriptor>> = {
  pending: {
    state: 'pending',
    label: 'En cola',
    icon: 'clock',
    colorToken: 'state-pending',
    actions: ['remove'],
  },
  prep: {
    state: 'prep',
    label: 'Esperando al conversor…',
    icon: 'hourglass',
    colorToken: 'state-prep',
    actions: ['cancel'],
  },
  converting: {
    state: 'converting',
    label: 'Convirtiendo',
    icon: 'spinner',
    colorToken: 'state-converting',
    actions: ['cancel'],
  },
  done: {
    state: 'done',
    label: 'Listo',
    icon: 'check',
    colorToken: 'state-done',
    actions: ['download'],
  },
  error: {
    state: 'error',
    label: 'Error',
    icon: 'alert',
    colorToken: 'state-error',
    // Las acciones reales dependen de ErrorClass; 'retry' se añade solo si es transitorio.
    actions: ['remove'],
  },
}
