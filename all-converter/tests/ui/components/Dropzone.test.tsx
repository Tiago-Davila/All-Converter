// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dropzone } from '../../../src/ui/components/Dropzone'

describe('Dropzone (T040)', () => {
  it('modo protagonista: muestra el prompt cuando no hay archivos', () => {
    render(<Dropzone hasFiles={false} onFiles={vi.fn()} />)
    expect(screen.getByTestId('dropzone-prompt')).toBeTruthy()
  })

  it('modo tira fina: oculta el prompt cuando hay archivos', () => {
    render(<Dropzone hasFiles={true} onFiles={vi.fn()} />)
    expect(screen.queryByTestId('dropzone-prompt')).toBeNull()
  })

  it('modo tira fina: data-compact=true cuando hay archivos', () => {
    render(<Dropzone hasFiles={true} onFiles={vi.fn()} />)
    expect(screen.getByTestId('dropzone').getAttribute('data-compact')).toBe('true')
  })

  it('modo protagonista: data-compact=false cuando no hay archivos', () => {
    render(<Dropzone hasFiles={false} onFiles={vi.fn()} />)
    expect(screen.getByTestId('dropzone').getAttribute('data-compact')).toBe('false')
  })

  it('modo tira fina: no muestra el botón de carpeta', () => {
    render(<Dropzone hasFiles={true} onFiles={vi.fn()} />)
    expect(screen.queryByTestId('btn-choose-folder')).toBeNull()
  })

  it('modo protagonista: muestra el botón de carpeta', () => {
    render(<Dropzone hasFiles={false} onFiles={vi.fn()} />)
    expect(screen.getByTestId('btn-choose-folder')).toBeTruthy()
  })

  it('activa data-drag-over durante dragover', () => {
    render(<Dropzone hasFiles={false} onFiles={vi.fn()} />)
    const zone = screen.getByTestId('dropzone')
    fireEvent.dragOver(zone)
    expect(zone.getAttribute('data-drag-over')).toBe('true')
    fireEvent.dragLeave(zone)
    expect(zone.getAttribute('data-drag-over')).toBe('false')
  })

  it('tiene role de sección con nombre accesible', () => {
    render(<Dropzone hasFiles={false} onFiles={vi.fn()} />)
    expect(screen.getByRole('region', { name: /agregar archivos/i })).toBeTruthy()
  })
})
