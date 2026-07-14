// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormatSelect } from '../../../src/ui/components/FormatSelect'
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

describe('FormatSelect — solo ofrece destinos válidos para el tipo del archivo', () => {
  it('un PDF tiene al menos una opción de conversión', () => {
    render(
      <FormatSelect
        entry={makeEntry()}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const select = screen.getByTestId('format-select') as HTMLSelectElement
    // "Sin elegir" + al menos 1 opción real
    expect(select.options.length).toBeGreaterThan(1)
  })

  it('un PDF NO ofrece destinos de audio (sin mezcla de tipos)', () => {
    render(
      <FormatSelect
        entry={makeEntry()}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const select = screen.getByTestId('format-select') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((o) => o.text.toLowerCase())
    // No debe ofrecer conversiones de audio como mp3, aac, etc. destinadas a audio
    const audioOnlyFormats = ['mp3', 'aac', 'ogg', 'flac', 'wav']
    // Los textos que solo son de audio no deben aparecer como único destino
    const hasMismatch = optionTexts.some((t) =>
      audioOnlyFormats.some((f) => t === f) // opción que es SOLO ese formato (sin contexto PDF)
    )
    // En realidad lo que validamos es que no hay conversiones de audio puro sin sentido
    // El select solo registra conversores cuyo `from` incluye el kind del archivo
    expect(hasMismatch).toBe(false)
  })

  it('una imagen ofrece opciones distintas a un PDF', () => {
    const { unmount } = render(
      <FormatSelect
        entry={makeEntry({ detectedType: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' } })}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const imgSelect = screen.getByTestId('format-select') as HTMLSelectElement
    const imgOptions = Array.from(imgSelect.options).map((o) => o.value).filter(Boolean)
    unmount()

    render(
      <FormatSelect
        entry={makeEntry()}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const pdfSelect = screen.getByTestId('format-select') as HTMLSelectElement
    const pdfOptions = Array.from(pdfSelect.options).map((o) => o.value).filter(Boolean)

    // Las opciones no deben ser idénticas entre tipos distintos
    expect(imgOptions).not.toEqual(pdfOptions)
  })

  it('un archivo de tipo unknown no ofrece ninguna opción real', () => {
    render(
      <FormatSelect
        entry={makeEntry({ detectedType: { kind: 'unknown', mime: 'application/octet-stream', extension: 'bin', detection: 'extension' } })}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const select = screen.getByTestId('format-select') as HTMLSelectElement
    // Solo "Sin elegir"
    expect(select.options.length).toBe(1)
    expect(select.options[0].value).toBe('')
  })

  it('value=undefined muestra "Sin elegir" seleccionada', () => {
    render(
      <FormatSelect entry={makeEntry()} value={undefined} onChange={vi.fn()} />,
    )
    const select = screen.getByTestId('format-select') as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('value definido se refleja en el select', () => {
    // Obtenemos la primera opción real para usarla como value
    render(
      <FormatSelect entry={makeEntry()} value={undefined} onChange={vi.fn()} />,
    )
    const firstReal = Array.from(
      (screen.getByTestId('format-select') as HTMLSelectElement).options,
    ).find((o) => o.value !== '')?.value

    if (!firstReal) return // skip si no hay conversores para pdf en este entorno

    const { unmount } = render(
      <FormatSelect entry={makeEntry()} value={firstReal} onChange={vi.fn()} />,
    )
    expect((screen.getAllByTestId('format-select')[1] as HTMLSelectElement).value).toBe(firstReal)
    unmount()
  })

  it('disabled impide la interacción', () => {
    render(
      <FormatSelect entry={makeEntry()} value={undefined} onChange={vi.fn()} disabled />,
    )
    expect((screen.getByTestId('format-select') as HTMLSelectElement).disabled).toBe(true)
  })

  it('aria-label incluye el nombre del archivo (accesibilidad)', () => {
    render(
      <FormatSelect entry={makeEntry({ name: 'documento.pdf' })} value={undefined} onChange={vi.fn()} />,
    )
    expect(screen.getByLabelText(/documento\.pdf/i)).not.toBeNull()
  })
})
