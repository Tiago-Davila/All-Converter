// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileRow } from '../../../src/ui/components/FileRow'
import type { FileRowProps } from '../../../src/ui/components/FileRow'
import type { FileEntry } from '../../../src/converters/types'

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'test-1',
    file: new File([''], 'test.pdf'),
    name: 'test.pdf',
    sizeBytes: 1024,
    detectedType: { kind: 'pdf', mime: 'application/pdf', extension: 'pdf', detection: 'magic-bytes' },
    state: 'ready',
    ...overrides,
  }
}

const noop = vi.fn()

function renderRow(props: Partial<FileRowProps> & { entry: FileEntry }) {
  return render(
    <FileRow
      onRemove={noop}
      onCancel={noop}
      onDownload={noop}
      onRetry={noop}
      {...props}
    />,
  )
}

// ── T013: no-solo-color ──────────────────────────────────────────────────────

describe('T013 — los 5 estados son distinguibles sin usar el color (SC-001)', () => {
  const stateConfigs = [
    { state: 'ready' as const, expectedIcon: 'clock', expectedText: 'En cola' },
    { state: 'converting' as const, engineReady: false, expectedIcon: 'hourglass', expectedText: 'Esperando al conversor' },
    { state: 'converting' as const, engineReady: true, expectedIcon: 'spinner', expectedText: 'Convirtiendo' },
    { state: 'completed' as const, expectedIcon: 'check', expectedText: 'Listo' },
    { state: 'error' as const, expectedIcon: 'alert', expectedText: 'error' },
  ]

  it('cada estado tiene un data-icon distinto (canal forma)', () => {
    const icons = new Set<string>()
    for (const cfg of stateConfigs) {
      const { container, unmount } = renderRow({
        entry: makeEntry({ state: cfg.state }),
        engineReady: cfg.engineReady,
        errorMessage: cfg.state === 'error' ? 'algo falló' : undefined,
      })
      const iconEl = container.querySelector('[data-icon]')
      expect(iconEl).not.toBeNull()
      icons.add(iconEl!.getAttribute('data-icon')!)
      unmount()
    }
    expect(icons.size).toBe(5)
  })

  it('pending: ícono clock y texto "En cola"', () => {
    renderRow({ entry: makeEntry({ state: 'ready' }) })
    expect(screen.getByTestId('file-row').querySelector('[data-icon="clock"]')).not.toBeNull()
    expect(screen.getByTestId('state-label').textContent).toContain('En cola')
  })

  it('prep: ícono hourglass y texto "Esperando al conversor"', () => {
    renderRow({ entry: makeEntry({ state: 'converting' }), engineReady: false })
    expect(screen.getByTestId('file-row').querySelector('[data-icon="hourglass"]')).not.toBeNull()
    expect(screen.getByTestId('state-label').textContent).toContain('Esperando al conversor')
  })

  it('converting: ícono spinner y porcentaje numérico real', () => {
    renderRow({ entry: makeEntry({ state: 'converting' }), progress: 42, engineReady: true })
    expect(screen.getByTestId('file-row').querySelector('[data-icon="spinner"]')).not.toBeNull()
    expect(screen.getByTestId('state-label').textContent).toContain('42%')
  })

  it('converting: barra de progreso determinística está presente (FR-017)', () => {
    renderRow({ entry: makeEntry({ state: 'converting' }), progress: 55, engineReady: true })
    expect(screen.getByTestId('progress-bar')).not.toBeNull()
  })

  it('done: ícono check y texto "Listo"', () => {
    renderRow({ entry: makeEntry({ state: 'completed' }) })
    expect(screen.getByTestId('file-row').querySelector('[data-icon="check"]')).not.toBeNull()
    expect(screen.getByTestId('state-label').textContent).toContain('Listo')
  })

  it('error: ícono alert (triángulo, forma distinta)', () => {
    renderRow({ entry: makeEntry({ state: 'error' }), errorMessage: 'algo falló' })
    expect(screen.getByTestId('file-row').querySelector('[data-icon="alert"]')).not.toBeNull()
  })

  it('el data-state del contenedor refleja el estado visual', () => {
    renderRow({ entry: makeEntry({ state: 'ready' }) })
    expect(screen.getByTestId('file-row').getAttribute('data-state')).toBe('pending')
  })

  it('el nombre accesible de la fila incluye su estado (aria-label)', () => {
    renderRow({ entry: makeEntry({ state: 'ready', name: 'doc.pdf' }) })
    const row = screen.getByTestId('file-row')
    expect(row.getAttribute('aria-label')).toContain('doc.pdf')
    expect(row.getAttribute('aria-label')).toContain('En cola')
  })

  it('rejected → no renderiza nada (va a tile de borde)', () => {
    const { container } = renderRow({ entry: makeEntry({ state: 'rejected' }) })
    expect(container.firstChild).toBeNull()
  })
})

// ── T013: acciones por estado ────────────────────────────────────────────────

describe('T013 — cada estado expone la acción correcta', () => {
  it('pending: acción Quitar', () => {
    renderRow({ entry: makeEntry({ state: 'ready' }) })
    expect(screen.getByRole('button', { name: /quitar/i })).not.toBeNull()
  })

  it('converting: acción Cancelar', () => {
    renderRow({ entry: makeEntry({ state: 'converting' }), engineReady: true })
    expect(screen.getByRole('button', { name: /cancelar/i })).not.toBeNull()
  })

  it('prep: acción Cancelar', () => {
    renderRow({ entry: makeEntry({ state: 'converting' }), engineReady: false })
    expect(screen.getByRole('button', { name: /cancelar/i })).not.toBeNull()
  })

  it('done: acción Descargar', () => {
    renderRow({ entry: makeEntry({ state: 'completed' }) })
    expect(screen.getByRole('button', { name: /descargar/i })).not.toBeNull()
  })

  it('error transitorio (cancelado): Quitar + Reintentar', () => {
    renderRow({ entry: makeEntry({ state: 'cancelled' }) })
    expect(screen.getByRole('button', { name: /quitar/i })).not.toBeNull()
    expect(screen.getByRole('button', { name: /reintentar/i })).not.toBeNull()
  })

  it('error determinístico (corrupto): solo Quitar, sin Reintentar (FR-019c)', () => {
    renderRow({ entry: makeEntry({ state: 'error' }), errorMessage: 'archivo corrupto' })
    expect(screen.getByRole('button', { name: /quitar/i })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull()
  })

  it('error transitorio (memoria): Quitar + Reintentar', () => {
    renderRow({ entry: makeEntry({ state: 'error' }), errorMessage: 'memoria insuficiente' })
    expect(screen.getByRole('button', { name: /reintentar/i })).not.toBeNull()
  })
})

// ── T016: causa concreta de error al enfocar (FR-043b) ──────────────────────

describe('T016 — la causa concreta del error está en el aria-label de la fila', () => {
  it('el aria-label incluye el mensaje de error concreto (FR-043b)', () => {
    renderRow({
      entry: makeEntry({ state: 'error', name: 'doc.pdf' }),
      errorMessage: 'algo falló inesperadamente',
    })
    const row = screen.getByTestId('file-row')
    expect(row.getAttribute('aria-label')).toContain('algo falló inesperadamente')
  })

  it('la fila es focusable (tabIndex=0) para que el lector la pueda enfocar', () => {
    renderRow({ entry: makeEntry({ state: 'error' }), errorMessage: 'error del motor' })
    expect(screen.getByTestId('file-row').getAttribute('tabIndex')).toBe('0')
  })

  it('error "cancelado por vos" aparece en aria-label para estado cancelled', () => {
    renderRow({ entry: makeEntry({ state: 'cancelled', name: 'video.mp4' }) })
    const row = screen.getByTestId('file-row')
    expect(row.getAttribute('aria-label')).toContain('cancelado por vos')
  })
})
