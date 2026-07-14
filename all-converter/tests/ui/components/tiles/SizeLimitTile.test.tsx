// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SizeLimitTile } from '../../../../src/ui/components/tiles/SizeLimitTile'

describe('SizeLimitTile', () => {
  const defaultProps = {
    fileName: 'video.mp4',
    fileSizeBytes: 52_428_800, // 50 MB
    maxSizeMB: 25,
    onRemove: vi.fn(),
  }

  it('muestra el tamaño real del archivo en MB', () => {
    render(<SizeLimitTile {...defaultProps} />)
    expect(screen.getByTestId('file-size').textContent).toBe('50.0 MB')
  })

  it('muestra el máximo permitido', () => {
    render(<SizeLimitTile {...defaultProps} />)
    expect(screen.getByTestId('max-size').textContent).toBe('25 MB')
  })

  it('indica que fue rechazado antes de convertir', () => {
    render(<SizeLimitTile {...defaultProps} />)
    expect(screen.getByTestId('reject-note').textContent).toMatch(/antes de intentar/i)
  })

  it('llama onRemove al hacer clic en Quitar', () => {
    const onRemove = vi.fn()
    render(<SizeLimitTile {...defaultProps} onRemove={onRemove} />)
    fireEvent.click(screen.getByTestId('btn-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<SizeLimitTile {...defaultProps} />)
    expect(screen.getByRole('region', { name: /video\.mp4/i })).toBeTruthy()
  })
})
