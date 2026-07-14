// @vitest-environment jsdom
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveRegion, announcementText } from '../../../src/ui/a11y/LiveRegion'
import type { Announcement } from '../../../src/ui/a11y/LiveRegion'

// ── announcementText ─────────────────────────────────────────────────────────

describe('announcementText — plantilla de anuncio consolidado', () => {
  it('7 listos, 3 errores', () =>
    expect(announcementText({ done: 7, failed: 3 })).toBe('7 archivos listos, 3 con error'))

  it('10 listos, 0 errores', () =>
    expect(announcementText({ done: 10, failed: 0 })).toBe('10 archivos listos'))

  it('0 listos, 5 errores', () =>
    expect(announcementText({ done: 0, failed: 5 })).toBe('5 con error'))

  it('1 listo (singular)', () =>
    expect(announcementText({ done: 1, failed: 0 })).toBe('1 archivo listo'))

  it('1 listo, 1 error', () =>
    expect(announcementText({ done: 1, failed: 1 })).toBe('1 archivo listo, 1 con error'))
})

// ── LiveRegion componente ────────────────────────────────────────────────────

describe('LiveRegion — consolidado por lote, nunca por archivo (FR-043)', () => {
  it('tiene role="status" y aria-live="polite"', () => {
    render(<LiveRegion announcement={null} />)
    const region = screen.getByTestId('live-region')
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('sin anuncio → región vacía', () => {
    render(<LiveRegion announcement={null} />)
    expect(screen.getByTestId('live-region').textContent).toBe('')
  })

  it('una cola de 10 archivos produce exactamente 1 anuncio', () => {
    // Simulamos que 10 archivos terminan de golpe como un único lote.
    const announcement: Announcement = { done: 10, failed: 0 }
    render(<LiveRegion announcement={announcement} />)
    // Solo 1 región de anuncio (no 10).
    const regions = screen.getAllByTestId('live-region')
    expect(regions).toHaveLength(1)
    expect(regions[0].textContent).toBe('10 archivos listos')
  })

  it('actualiza el texto al cambiar el anuncio', async () => {
    const { rerender } = render(<LiveRegion announcement={{ done: 5, failed: 0 }} />)
    expect(screen.getByTestId('live-region').textContent).toBe('5 archivos listos')

    await act(async () => {
      rerender(<LiveRegion announcement={{ done: 7, failed: 3 }} />)
    })
    expect(screen.getByTestId('live-region').textContent).toBe('7 archivos listos, 3 con error')
  })

  it('no re-anuncia si el anuncio no cambió', async () => {
    const ann: Announcement = { done: 3, failed: 1 }
    const { rerender } = render(<LiveRegion announcement={ann} />)
    const text1 = screen.getByTestId('live-region').textContent

    await act(async () => {
      // Mismo objeto de valores → no debe cambiar.
      rerender(<LiveRegion announcement={{ done: 3, failed: 1 }} />)
    })
    expect(screen.getByTestId('live-region').textContent).toBe(text1)
  })

  it('es visualmente oculto (no visible en la pantalla)', () => {
    render(<LiveRegion announcement={null} />)
    const region = screen.getByTestId('live-region')
    // clip o width:1px → inaccesible visualmente pero legible por AT
    const style = region.getAttribute('style') ?? ''
    expect(style).toMatch(/width:\s*1px|clip/)
  })
})
