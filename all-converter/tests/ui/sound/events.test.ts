import { describe, it, expect } from 'vitest'
import {
  SOUND_EVENTS,
  REQUIRED_SOUND_EVENTS,
  getSoundEntry,
} from '../../../src/ui/sound/events'

describe('events.ts — tabla de sonido (T033)', () => {
  it('contiene exactamente los 4 eventos obligatorios', () => {
    const required = ['drop', 'reject', 'queue-done-ok', 'queue-done-errors']
    for (const evt of required) {
      expect(REQUIRED_SOUND_EVENTS).toContain(evt)
    }
    expect(REQUIRED_SOUND_EVENTS).toHaveLength(4)
  })

  it('todo evento de la tabla tiene equivalente visual declarado (invariante 2)', () => {
    for (const entry of SOUND_EVENTS) {
      expect(entry.visualEquivalent, `${entry.event} sin equivalente visual`).toBeTruthy()
      expect(entry.visualEquivalent.length, `${entry.event} equivalente vacío`).toBeGreaterThan(0)
    }
  })

  it('los 4 eventos obligatorios tienen asset declarado', () => {
    for (const evt of REQUIRED_SOUND_EVENTS) {
      const entry = getSoundEntry(evt)
      expect(entry, `${evt} no está en la tabla`).toBeTruthy()
      expect(entry!.asset, `${evt} sin asset`).toBeTruthy()
    }
  })

  it('no existen eventos CONVERT_START ni CONVERT_DONE (prohibidos por FR-029b)', () => {
    const names = SOUND_EVENTS.map((e) => e.event)
    expect(names).not.toContain('convert-start')
    expect(names).not.toContain('convert-done')
    expect(names).not.toContain('CONVERT_START')
    expect(names).not.toContain('CONVERT_DONE')
  })

  it('getSoundEntry devuelve la entrada correcta para cada evento', () => {
    expect(getSoundEntry('drop')?.asset).toBe('drop')
    expect(getSoundEntry('queue-done-ok')?.asset).toBe('done-ok')
    expect(getSoundEntry('queue-done-errors')?.asset).toBe('done-errors')
    expect(getSoundEntry('reject')?.asset).toBe('reject')
  })

  it('getSoundEntry devuelve undefined para eventos desconocidos', () => {
    // @ts-expect-error: probamos un evento inexistente a propósito
    expect(getSoundEntry('unknown-event')).toBeUndefined()
  })

  it('los eventos opcionales tienen equivalente visual aunque no tengan asset', () => {
    const optional = SOUND_EVENTS.filter((e) => e.asset === null)
    for (const entry of optional) {
      expect(entry.visualEquivalent.length).toBeGreaterThan(0)
    }
  })
})
