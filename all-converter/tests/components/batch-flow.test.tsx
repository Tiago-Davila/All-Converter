// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedFileType, FileEntry } from '../../src/converters/types'
import { FileQueue } from '../../src/components/FileQueue'

const hoisted = vi.hoisted(() => ({ imageCalls: [] as string[] }))

vi.mock('../../src/converters/registry', () => {
  const image = {
    id: 'fake-image', label: 'Convertir imagen', from: ['image'], to: 'jpg|webp', maxSizeMB: 50,
    async convert(file: File, _onProgress: unknown, options: Record<string, unknown>) {
      hoisted.imageCalls.push(file.name)
      if (file.name === 'malo.png') throw new Error('El archivo parece estar dañado o incompleto.')
      const target = String(options.target)
      return [{ name: file.name.replace(/\.png$/, `.${target}`), mime: `image/${target}`, buffer: new TextEncoder().encode(target).buffer, sizeBytes: 3 }]
    },
  }
  const sheet = {
    id: 'fake-sheet', label: 'Convertir planilla', from: ['spreadsheet'], to: 'xlsx', maxSizeMB: 25,
    async convert(file: File, _onProgress: unknown, options: Record<string, unknown>) {
      const target = String(options.target)
      return [{ name: file.name.replace(/\.csv$/, `.${target}`), mime: 'application/vnd.ms-excel', buffer: new TextEncoder().encode(target).buffer, sizeBytes: 3 }]
    },
  }
  return {
    converters: [image, sheet],
    getAvailableConverters: (type: DetectedFileType) => (type.kind === 'image' ? [image] : [sheet]),
    getConverterTargets: (converter: { to: string }) => converter.to.split('|'),
  }
})

URL.createObjectURL = vi.fn(() => 'blob:zip')
URL.revokeObjectURL = vi.fn()

function imageEntry(name: string): FileEntry {
  return { id: name, file: new File(['x'], name), name, sizeBytes: 1, detectedType: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' }, state: 'ready', relativePath: `fotos/${name}` }
}

function sheetEntry(name: string): FileEntry {
  return { id: name, file: new File(['x'], name), name, sizeBytes: 1, detectedType: { kind: 'spreadsheet', mime: 'text/csv', extension: 'csv', detection: 'magic-bytes' }, state: 'ready', relativePath: `datos/${name}` }
}

/** Elige el destino de una fila por el nombre del archivo (FR-023b). */
function chooseTarget(fileName: string, optionLabel: string): void {
  const select = screen.getByLabelText(fileName, { selector: 'select' })
  const option = Array.from(select.querySelectorAll('option')).find((candidate) => candidate.textContent === optionLabel)
  fireEvent.change(select, { target: { value: option!.value } })
}

describe('flujo de lote', () => {
  it('convierte un lote de formatos mezclados, cada archivo a su propio destino (FR-023b)', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), imageEntry('b.png'), sheetEntry('datos.csv')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('b.png', 'WEBP')
    chooseTarget('datos.csv', 'XLSX')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/b\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/datos\.csv: completed/)).toBeTruthy()
  })

  it('solo ofrece a cada archivo los destinos válidos para su tipo (FR-023b)', () => {
    render(<FileQueue entries={[imageEntry('a.png'), sheetEntry('datos.csv')]} />)
    const imageOptions = Array.from(screen.getByLabelText('a.png', { selector: 'select' }).querySelectorAll('option')).map((option) => option.textContent)
    const sheetOptions = Array.from(screen.getByLabelText('datos.csv', { selector: 'select' }).querySelectorAll('option')).map((option) => option.textContent)
    expect(imageOptions).toEqual(['Elegí un formato destino', 'JPG', 'WEBP'])
    expect(sheetOptions).toEqual(['Elegí un formato destino', 'XLSX'])
  })

  it('omite sin bloquear los archivos sin destino elegido (FR-023c)', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), sheetEntry('datos.csv')]} />)
    chooseTarget('a.png', 'JPG')
    expect(screen.getByText(/1 archivo\(s\) sin formato destino/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.queryByText(/datos\.csv: completed/)).toBeNull()
  })

  it('conserva los éxitos ante fallos parciales', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), imageEntry('malo.png')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('malo.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/malo\.png: error/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('dañado')
  })

  it('no permite convertir sin ningún destino elegido', () => {
    render(<FileQueue entries={[imageEntry('a.png')]} />)
    expect(screen.getByRole('button', { name: 'Convertir todos' }).hasAttribute('disabled')).toBe(true)
  })

  it('no muestra panel de lote sin archivos listos', () => {
    render(<FileQueue entries={[]} />)
    expect(screen.queryByRole('button', { name: 'Convertir todos' })).toBeNull()
  })

  it('al reconvertir solo procesa los pendientes y preserva lo ya convertido', async () => {
    hoisted.imageCalls.length = 0
    const { rerender } = render(<FileQueue entries={[imageEntry('a.png')]} />)
    chooseTarget('a.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(hoisted.imageCalls).toEqual(['a.png'])

    // Llega un archivo nuevo a la cola (a.png ya está listo).
    rerender(<FileQueue entries={[imageEntry('a.png'), imageEntry('b.png')]} />)
    chooseTarget('b.png', 'JPG')
    const button = screen.getByRole('button', { name: /Convertir pendientes/ })
    expect(button.textContent).toContain('(1)')

    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText(/b\.png: completed/)).toBeTruthy())
    // a.png NO se reconvirtió (sigue una sola llamada) y quedó preservado.
    expect(hoisted.imageCalls).toEqual(['a.png', 'b.png'])
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
  })
})
