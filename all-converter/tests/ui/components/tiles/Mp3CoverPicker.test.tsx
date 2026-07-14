// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Mp3CoverPicker, DEFAULT_COVER } from '../../../../src/ui/components/tiles/Mp3CoverPicker'
import type { CoverSource } from '../../../../src/ui/components/tiles/Mp3CoverPicker'

function Wrapper({ initial = { type: 'default' } as CoverSource }: { initial?: CoverSource }) {
  const [cover, setCover] = useState<CoverSource>(initial)
  return (
    <div>
      <Mp3CoverPicker fileName="cancion.mp3" cover={cover} onCoverChange={setCover} />
      <span data-testid="cover-type">{cover.type}</span>
    </div>
  )
}

describe('Mp3CoverPicker', () => {
  it('DEFAULT_COVER es la constante "default-waveform"', () => {
    expect(DEFAULT_COVER).toBe('default-waveform')
  })

  it('muestra descripción de waveform por defecto', () => {
    render(<Wrapper />)
    expect(screen.getByTestId('cover-description').textContent).toMatch(/waveform/i)
  })

  it('muestra botón de elegir imagen', () => {
    render(<Wrapper />)
    expect(screen.getByTestId('btn-choose-image')).toBeTruthy()
  })

  it('no muestra botón de volver al waveform cuando el cover es el default', () => {
    render(<Wrapper />)
    expect(screen.queryByTestId('btn-reset-waveform')).toBeNull()
  })

  it('al elegir imagen muestra botón de volver al waveform', () => {
    render(<Wrapper />)
    // Simular cambio de cover a custom
    const file = new File(['img'], 'cover.jpg', { type: 'image/jpeg' })
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), writable: true })
    const input = screen.getByTestId('cover-file-input')
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByTestId('btn-reset-waveform')).toBeTruthy()
  })

  it('al hacer clic en "Volver al waveform" el cover vuelve al default', () => {
    render(<Wrapper />)
    const file = new File(['img'], 'cover.jpg', { type: 'image/jpeg' })
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), writable: true })
    const input = screen.getByTestId('cover-file-input')
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByTestId('btn-reset-waveform'))
    expect(screen.getByTestId('cover-type').textContent).toBe('default')
  })

  it('"Convertir" NUNCA está bloqueado — no hay botón de convertir en el picker', () => {
    render(<Wrapper />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => {
      expect(btn.textContent?.toLowerCase()).not.toContain('convertir')
    })
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<Wrapper />)
    expect(screen.getByRole('region', { name: /cancion\.mp3/i })).toBeTruthy()
  })
})
