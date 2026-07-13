// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { NoAudioTile } from '../../../../src/ui/components/tiles/NoAudioTile'

describe('NoAudioTile', () => {
  const mockFormatSelect = <select data-testid="format-select"><option value="mp4">MP4</option></select>

  it('muestra aviso de falta de pista de audio', () => {
    render(<NoAudioTile fileName="clip.avi" formatSelect={mockFormatSelect} onRemove={vi.fn()} />)
    expect(screen.getByTestId('no-audio-message').textContent).toMatch(/no tiene pista de audio/i)
  })

  it('ofrece alternativa de formato de video', () => {
    render(<NoAudioTile fileName="clip.avi" formatSelect={mockFormatSelect} onRemove={vi.fn()} />)
    expect(screen.getByTestId('alternative-note').textContent).toMatch(/otro formato de video/i)
  })

  it('renderiza el selector de formato inyectado', () => {
    render(<NoAudioTile fileName="clip.avi" formatSelect={mockFormatSelect} onRemove={vi.fn()} />)
    expect(screen.getByTestId('format-select')).toBeTruthy()
  })

  it('llama onRemove al hacer clic en Quitar', () => {
    const onRemove = vi.fn()
    render(<NoAudioTile fileName="clip.avi" formatSelect={mockFormatSelect} onRemove={onRemove} />)
    fireEvent.click(screen.getByTestId('btn-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<NoAudioTile fileName="clip.avi" formatSelect={mockFormatSelect} onRemove={vi.fn()} />)
    expect(screen.getByRole('region', { name: /clip\.avi/i })).toBeTruthy()
  })
})
