// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UnsupportedTile } from '../../../../src/ui/components/tiles/UnsupportedTile'

describe('UnsupportedTile', () => {
  const defaultProps = {
    fileName: 'archivo.xyz',
    acceptedFormats: ['jpg', 'png', 'pdf', 'mp3'],
    onRemove: vi.fn(),
  }

  it('muestra el nombre del archivo', () => {
    render(<UnsupportedTile {...defaultProps} />)
    expect(screen.getByTestId('unsupported-message').textContent).toContain('archivo.xyz')
  })

  it('enumera los formatos aceptados', () => {
    render(<UnsupportedTile {...defaultProps} />)
    expect(screen.getByTestId('accepted-formats').textContent).toContain('jpg')
    expect(screen.getByTestId('accepted-formats').textContent).toContain('pdf')
  })

  it('NO contiene selector de formato (no es convertible)', () => {
    render(<UnsupportedTile {...defaultProps} />)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('NO contiene botón de convertir', () => {
    render(<UnsupportedTile {...defaultProps} />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => {
      expect(btn.textContent?.toLowerCase()).not.toContain('convertir')
    })
  })

  it('contiene solo la acción Quitar', () => {
    render(<UnsupportedTile {...defaultProps} />)
    expect(screen.getByTestId('btn-remove')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('llama onRemove al hacer clic en Quitar', () => {
    const onRemove = vi.fn()
    render(<UnsupportedTile {...defaultProps} onRemove={onRemove} />)
    fireEvent.click(screen.getByTestId('btn-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<UnsupportedTile {...defaultProps} />)
    expect(screen.getByRole('region', { name: /archivo\.xyz/i })).toBeTruthy()
  })
})
