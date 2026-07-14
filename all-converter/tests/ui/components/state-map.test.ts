import { describe, expect, it } from 'vitest'
import { toVisualState, STATE_DESCRIPTORS } from '../../../src/ui/components/state-map'
import type { QueueState } from '../../../src/converters/types'

describe('toVisualState — mapeo de los 8 estados de QueueState', () => {
  it('detecting → pending', () => expect(toVisualState('detecting')).toBe('pending'))
  it('ready → pending', () => expect(toVisualState('ready')).toBe('pending'))
  it('queued → pending', () => expect(toVisualState('queued')).toBe('pending'))

  it('converting + engineReady=true → converting', () =>
    expect(toVisualState('converting', true)).toBe('converting'))

  it('converting + engineReady=false → prep', () =>
    expect(toVisualState('converting', false)).toBe('prep'))

  it('completed → done', () => expect(toVisualState('completed')).toBe('done'))

  it('error → error', () => expect(toVisualState('error')).toBe('error'))

  it('cancelled → error (transitorio reintentable, FR-015 clarificación 2026-07-14)', () =>
    expect(toVisualState('cancelled')).toBe('error'))

  it('rejected → hidden (va a tile de borde, no a la cola)', () =>
    expect(toVisualState('rejected')).toBe('hidden'))
})

describe('STATE_DESCRIPTORS — cada estado visual tiene ícono, texto y token distintos', () => {
  const states = ['pending', 'prep', 'converting', 'done', 'error'] as const

  it('todos los estados están definidos', () => {
    for (const s of states) expect(STATE_DESCRIPTORS[s]).toBeDefined()
  })

  it('cada estado tiene un ícono distinto', () => {
    const icons = states.map((s) => STATE_DESCRIPTORS[s].icon)
    expect(new Set(icons).size).toBe(states.length)
  })

  it('cada estado tiene un texto distinto', () => {
    const labels = states.map((s) => STATE_DESCRIPTORS[s].label)
    expect(new Set(labels).size).toBe(states.length)
  })

  it('cada estado tiene un colorToken distinto', () => {
    const tokens = states.map((s) => STATE_DESCRIPTORS[s].colorToken)
    expect(new Set(tokens).size).toBe(states.length)
  })

  it('pending tiene acción remove', () => expect(STATE_DESCRIPTORS.pending.actions).toContain('remove'))
  it('prep tiene acción cancel', () => expect(STATE_DESCRIPTORS.prep.actions).toContain('cancel'))
  it('converting tiene acción cancel', () => expect(STATE_DESCRIPTORS.converting.actions).toContain('cancel'))
  it('done tiene acción download', () => expect(STATE_DESCRIPTORS.done.actions).toContain('download'))
  it('error base tiene acción remove', () => expect(STATE_DESCRIPTORS.error.actions).toContain('remove'))
})

describe('cobertura exhaustiva: todos los QueueState tienen un mapeo', () => {
  const allStates: QueueState[] = [
    'detecting', 'ready', 'queued', 'converting', 'completed', 'error', 'cancelled', 'rejected',
  ]
  it('ningún estado queda sin mapear', () => {
    for (const s of allStates) {
      expect(toVisualState(s)).toBeDefined()
    }
  })
})
