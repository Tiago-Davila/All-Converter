import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../../src/ui/a11y/contrast'
import { MIN_CONTRAST, SURFACE, TOKENS, UI_TOKENS, type ColorToken } from '../../../src/ui/a11y/tokens'

/**
 * Puerta de accesibilidad (Constitucion Principio XII): agregar un token que no
 * cumple AA contra la superficie debe romper esta prueba, no descubrirse a ojo.
 */
describe('puerta de contraste AA', () => {
  const tokenNames = Object.keys(TOKENS) as ColorToken[]

  it('no deja ningún ColorToken sin verificar', () => {
    expect(tokenNames.length).toBeGreaterThan(0)
  })

  it.each(tokenNames)('%s cumple su umbral AA contra SURFACE', (token) => {
    const isUiToken = (UI_TOKENS as readonly string[]).includes(token)
    const threshold = isUiToken ? MIN_CONTRAST.ui : MIN_CONTRAST.text
    const ratio = contrastRatio(TOKENS[token], SURFACE)
    expect(ratio).toBeGreaterThanOrEqual(threshold)
  })

  it('rechaza un token sintético que no cumple AA (control negativo de la puerta)', () => {
    const failingToken = '#3a3157' // pico alto del shader, research §D1: 3.23 contra texto-tenue
    const ratio = contrastRatio(failingToken, SURFACE)
    expect(ratio).toBeLessThan(MIN_CONTRAST.text)
  })
})
