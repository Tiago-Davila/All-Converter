import { describe, it, expect } from 'vitest'
import { targetFor } from '../../../src/ui/background/intensity'

describe('targetFor — mapeo evento → intensidad (T026)', () => {
  it('idle → 0.25', () => {
    expect(targetFor('idle')).toBe(0.25)
  })

  it('hover → 0.78', () => {
    expect(targetFor('hover')).toBe(0.78)
  })

  it('drag-over → 1.00', () => {
    expect(targetFor('drag-over')).toBe(1.0)
  })

  it('converting sin progress → 0.40 (mínimo)', () => {
    expect(targetFor('converting')).toBeCloseTo(0.40)
  })

  it('converting progress=0 → 0.40', () => {
    expect(targetFor('converting', 0)).toBeCloseTo(0.40)
  })

  it('converting progress=1 → 0.85 (máximo)', () => {
    expect(targetFor('converting', 1)).toBeCloseTo(0.85)
  })

  it('converting progress=0.5 → 0.625', () => {
    expect(targetFor('converting', 0.5)).toBeCloseTo(0.625)
  })

  it('converting progress crece monotónamente con p', () => {
    const v0 = targetFor('converting', 0)
    const v5 = targetFor('converting', 0.5)
    const v1 = targetFor('converting', 1)
    expect(v0).toBeLessThan(v5)
    expect(v5).toBeLessThan(v1)
  })

  it('converting queda en [0.40, 0.85] para cualquier p en [0,1]', () => {
    for (let p = 0; p <= 1; p += 0.1) {
      const v = targetFor('converting', p)
      expect(v).toBeGreaterThanOrEqual(0.40)
      expect(v).toBeLessThanOrEqual(0.85 + 1e-9)
    }
  })

  it('converting clampea progress fuera de [0,1]', () => {
    expect(targetFor('converting', -1)).toBeCloseTo(0.40)
    expect(targetFor('converting', 2)).toBeCloseTo(0.85)
  })
})
