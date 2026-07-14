// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectCapabilities, planFor } from '../../../src/ui/a11y/capabilities'

describe('planFor — matriz de degradación (research.md §D6)', () => {
  it('WebGL + WebAudio, sin reduce-motion → shader animado, sonido permitido', () => {
    expect(planFor({ webgl: true, webAudio: true, reducedMotion: false }))
      .toEqual({ background: 'shader', soundAllowed: true })
  })

  it('WebGL + WebAudio + reduce-motion → estático, mudo (RM vetea ambos)', () => {
    expect(planFor({ webgl: true, webAudio: true, reducedMotion: true }))
      .toEqual({ background: 'static', soundAllowed: false })
  })

  it('WebGL sin WebAudio, sin reduce-motion → shader animado, mudo (sin error)', () => {
    expect(planFor({ webgl: true, webAudio: false, reducedMotion: false }))
      .toEqual({ background: 'shader', soundAllowed: false })
  })

  it('sin WebGL, con WebAudio, sin reduce-motion → gradiente CSS, sonido permitido', () => {
    expect(planFor({ webgl: false, webAudio: true, reducedMotion: false }))
      .toEqual({ background: 'static', soundAllowed: true })
  })

  it('sin WebGL, sin WebAudio, con reduce-motion → gradiente CSS, mudo', () => {
    expect(planFor({ webgl: false, webAudio: false, reducedMotion: true }))
      .toEqual({ background: 'static', soundAllowed: false })
  })

  it('ninguna fila de la matriz depende de datos de archivos ni produce error', () => {
    const rows = [
      { webgl: true, webAudio: true, reducedMotion: false },
      { webgl: true, webAudio: true, reducedMotion: true },
      { webgl: true, webAudio: false, reducedMotion: false },
      { webgl: false, webAudio: true, reducedMotion: false },
      { webgl: false, webAudio: false, reducedMotion: true },
    ]
    for (const caps of rows) expect(() => planFor(caps)).not.toThrow()
  })
})

describe('detectCapabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reporta reducedMotion=true cuando matchMedia lo indica', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList)
    expect(detectCapabilities().reducedMotion).toBe(true)
  })

  it('reporta reducedMotion=false cuando matchMedia no lo indica', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }) as MediaQueryList)
    expect(detectCapabilities().reducedMotion).toBe(false)
  })

  it('no lanza si matchMedia no existe (navegador viejo)', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => detectCapabilities()).not.toThrow()
  })
})
