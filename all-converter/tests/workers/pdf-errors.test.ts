import { describe, expect, it } from 'vitest'
import { normalizePdfError } from '../../src/workers/pdf-errors'

describe('errores PDF unificados', () => {
  it('normaliza protección y corrupción con mensajes accionables', () => {
    expect(normalizePdfError(new Error('File is encrypted')).message).toMatch(/protegido.*contraseña/i)
    expect(normalizePdfError(new Error('Invalid PDF header')).message).toMatch(/dañado|incompleto/i)
  })
})
