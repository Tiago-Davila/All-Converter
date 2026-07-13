// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '../../src/converters/types'
import { FileQueue } from '../../src/components/FileQueue'

vi.mock('../../src/converters/registry', () => {
  const fake = {
    id: 'fake-image', label: 'Convertir imagen', from: ['image'], to: 'jpg', maxSizeMB: 50,
    async convert(file: File) {
      if (file.name === 'malo.png') throw new Error('El archivo parece estar dañado o incompleto.')
      return [{ name: file.name.replace(/\.png$/, '.jpg'), mime: 'image/jpeg', buffer: new TextEncoder().encode('jpg').buffer, sizeBytes: 3 }]
    },
  }
  return { converters: [fake], getAvailableConverters: () => [fake], getConverterTargets: (converter: { to: string }) => converter.to.split('|') }
})

URL.createObjectURL = vi.fn(() => 'blob:zip')
URL.revokeObjectURL = vi.fn()

function entry(name: string): FileEntry {
  return { id: name, file: new File(['x'], name), name, sizeBytes: 1, detectedType: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' }, state: 'ready', relativePath: `fotos/${name}` }
}

describe('flujo de lote', () => {
  it('convierte el lote, conserva los éxitos ante fallos parciales y ofrece el ZIP', async () => {
    render(<FileQueue entries={[entry('a.png'), entry('b.png'), entry('malo.png')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/b\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/malo\.png: error/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('dañado')
  })

  it('no muestra panel de lote sin archivos listos', () => {
    render(<FileQueue entries={[]} />)
    expect(screen.queryByRole('button', { name: 'Convertir todos' })).toBeNull()
  })
})
