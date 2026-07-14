// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { StaticBackground } from '../../../src/ui/background/StaticBackground'
import { ShaderBackground } from '../../../src/ui/background/ShaderBackground'

describe('StaticBackground (T030)', () => {
  it('renderiza sin lanzar errores', () => {
    expect(() => render(<StaticBackground />)).not.toThrow()
  })

  it('es decorativo: aria-hidden', () => {
    render(<StaticBackground />)
    expect(screen.getByTestId('static-background').getAttribute('aria-hidden')).toBe('true')
  })

  it('pointer-events none: no bloquea la UI', () => {
    render(<StaticBackground />)
    const el = screen.getByTestId('static-background') as HTMLElement
    expect(el.style.pointerEvents).toBe('none')
  })

  it('usa gradiente CSS (no canvas)', () => {
    render(<StaticBackground />)
    const el = screen.getByTestId('static-background') as HTMLElement
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.style.background).toContain('gradient')
  })
})

describe('ShaderBackground — degradación (T030)', () => {
  beforeEach(() => {
    // jsdom no tiene WebGL: getContext('webgl2') devuelve null → degrada a estático
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('degrada a StaticBackground cuando no hay WebGL', () => {
    render(<ShaderBackground targetIntensity={0.25} />)
    expect(screen.getByTestId('static-background')).toBeTruthy()
    expect(screen.queryByTestId('shader-background')).toBeNull()
  })

  it('degrada a StaticBackground bajo prefers-reduced-motion', () => {
    // jsdom no define matchMedia; lo definimos manualmente para simular reduce-motion
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })

    render(<ShaderBackground targetIntensity={0.25} />)
    expect(screen.getByTestId('static-background')).toBeTruthy()
  })
})
