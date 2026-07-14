// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  readPrefs,
  writePrefs,
} from '../../../src/ui/prefs/ui-prefs'

describe('ui-prefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('Invariante 3 — sin valor guardado devuelve soundEnabled: false', () => {
    const prefs = readPrefs()
    expect(prefs).toEqual(DEFAULT_PREFS)
    expect(prefs.soundEnabled).toBe(false)
  })

  it('Invariante 4 — JSON corrupto → default, sin throw', () => {
    localStorage.setItem(PREFS_KEY, '{esto no es json válido}')
    expect(() => readPrefs()).not.toThrow()
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('Invariante 4 — localStorage que lanza al escribir → no propaga', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => writePrefs({ soundEnabled: true })).not.toThrow()
  })

  it('Invariante 5 — round-trip: escribir y leer coincide', () => {
    writePrefs({ soundEnabled: true })
    expect(readPrefs()).toEqual({ soundEnabled: true })

    writePrefs({ soundEnabled: false })
    expect(readPrefs()).toEqual({ soundEnabled: false })
  })

  it('Invariante 1 — lo persistido no contiene claves fuera de soundEnabled', () => {
    writePrefs({ soundEnabled: true })
    const raw = localStorage.getItem(PREFS_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as Record<string, unknown>
    const keys = Object.keys(parsed)
    expect(keys).toEqual(['soundEnabled'])
    expect(keys).not.toContain('fileName')
    expect(keys).not.toContain('fileContent')
    expect(keys).not.toContain('history')
  })
})
