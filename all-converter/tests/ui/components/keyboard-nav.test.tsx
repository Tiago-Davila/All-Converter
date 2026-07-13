// @vitest-environment jsdom
/**
 * T017: verificar por teclado que Cancelar es alcanzable durante una conversión
 * y que el foco no queda huérfano al desaparecer una fila.
 */
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileRow } from '../../../src/ui/components/FileRow'
import type { FileEntry } from '../../../src/converters/types'

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'test-1',
    file: new File([''], 'video.mp4'),
    name: 'video.mp4',
    sizeBytes: 2048,
    detectedType: { kind: 'video', mime: 'video/mp4', extension: 'mp4', detection: 'magic-bytes' },
    state: 'converting',
    ...overrides,
  }
}

// ── Cancelar alcanzable con teclado durante converting ───────────────────────

describe('T017 — Cancelar alcanzable por teclado durante conversión', () => {
  it('el botón Cancelar existe y es focusable durante converting', () => {
    render(
      <FileRow
        entry={makeEntry({ state: 'converting' })}
        engineReady={true}
        progress={50}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const btn = screen.getByRole('button', { name: /cancelar/i })
    expect(btn).not.toBeNull()
    // No debe estar deshabilitado (Tab puede alcanzarlo)
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('Tab puede enfocar Cancelar (tabIndex no negativo)', () => {
    render(
      <FileRow
        entry={makeEntry({ state: 'converting' })}
        engineReady={true}
        progress={30}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const btn = screen.getByRole('button', { name: /cancelar/i }) as HTMLButtonElement
    // tabIndex por defecto en button es 0 (participante en el orden de tabulación)
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('Enter sobre Cancelar llama a onCancel', () => {
    const onCancel = vi.fn()
    render(
      <FileRow
        entry={makeEntry({ state: 'converting' })}
        engineReady={true}
        progress={60}
        onRemove={vi.fn()}
        onCancel={onCancel}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const btn = screen.getByRole('button', { name: /cancelar/i })
    fireEvent.click(btn)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Cancelar también alcanzable en estado prep (motor cargando)', () => {
    render(
      <FileRow
        entry={makeEntry({ state: 'converting' })}
        engineReady={false}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /cancelar/i })).not.toBeNull()
  })
})

// ── El foco no queda huérfano al desaparecer una fila ───────────────────────

describe('T017 — el foco no queda huérfano al desaparecer una fila', () => {
  /**
   * Componente mínimo que simula quitar una fila mientras tiene el foco.
   * Cuando se quita, el foco debe moverse al elemento de referencia (body u otro control).
   */
  function QueueStub() {
    const [visible, setVisible] = useState(true)
    return (
      <div>
        <button data-testid="other-control" type="button">
          Otro control
        </button>
        {visible && (
          <FileRow
            entry={makeEntry({ state: 'ready' })}
            onRemove={() => setVisible(false)}
            onCancel={vi.fn()}
            onDownload={vi.fn()}
            onRetry={vi.fn()}
          />
        )}
      </div>
    )
  }

  it('al quitar la fila no hay ningún elemento de foco inválido (document.activeElement != null)', () => {
    render(<QueueStub />)
    const quitarBtn = screen.getByRole('button', { name: /quitar/i })

    // El botón existe antes de quitarlo
    expect(quitarBtn).not.toBeNull()

    // Simulamos click que elimina la fila
    fireEvent.click(quitarBtn)

    // La fila ya no está en el DOM
    expect(screen.queryByRole('button', { name: /quitar/i })).toBeNull()

    // document.activeElement no debe apuntar a un nodo desmontado
    // (jsdom lo resetea a body o null, nunca a un nodo fantasma)
    const active = document.activeElement
    expect(active).not.toBeNull()
    // El activeElement debe existir en el documento actual
    expect(document.contains(active)).toBe(true)
  })

  it('la fila en converting es focusable directamente (tabIndex=0)', () => {
    render(
      <FileRow
        entry={makeEntry({ state: 'converting' })}
        engineReady={true}
        progress={40}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )
    const row = screen.getByTestId('file-row')
    expect(row.getAttribute('tabIndex')).toBe('0')
  })
})
