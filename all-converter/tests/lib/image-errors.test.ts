import { describe, expect, it } from 'vitest'
import { imageErrorMessage } from '../../src/lib/image-errors'

describe('errores de imagen', () => {
  it('traduce falta de memoria en un mensaje accionable', () => {
    expect(imageErrorMessage(new RangeError('allocation failed'))).toMatch(/memoria.*archivo más chico/i)
    expect(imageErrorMessage(new DOMException('quota', 'QuotaExceededError'))).toMatch(/memoria/i)
  })
})
