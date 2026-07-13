import { describe, expect, it } from 'vitest'
import { contrastRatio, meetsAA, relativeLuminance } from '../../../src/ui/a11y/contrast'

describe('contraste WCAG', () => {
  it('calcula el contraste máximo entre blanco y negro puros', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
  })

  it('da contraste 1 para el mismo color', () => {
    expect(contrastRatio('#161521', '#161521')).toBeCloseTo(1, 5)
  })

  it('es simétrico: el orden de los argumentos no importa', () => {
    expect(contrastRatio('#f2f4f8', '#161521')).toBeCloseTo(contrastRatio('#161521', '#f2f4f8'), 10)
  })

  it('reproduce los ratios verificados en research.md (superficie #161521)', () => {
    // Valores de research.md §D2, calculados con la misma fórmula WCAG.
    expect(contrastRatio('#f2f4f8', '#161521')).toBeCloseTo(16.39, 1)
    expect(contrastRatio('#7d8598', '#161521')).toBeCloseTo(4.88, 1)
    expect(contrastRatio('#8b7cf0', '#161521')).toBeCloseTo(5.36, 1)
  })

  it('meetsAA respeta el umbral exacto (4.5 pasa, 4.49 no)', () => {
    // Par sintético con ratio exactamente 4.5 esperado por diseño del test de arriba.
    expect(meetsAA('#f2f4f8', '#161521', 4.5)).toBe(true)
    expect(meetsAA('#7d8598', '#161521', 4.5)).toBe(true)
    expect(meetsAA('#7d8598', '#161521', 5.0)).toBe(false)
  })

  it('relativeLuminance de negro es 0 y de blanco es 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})
