// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResizePage } from '../../../src/ui/components/ResizePage'

const { convert } = vi.hoisted(() => ({
  convert: vi.fn(async () => [
    { name: 'foto-800x600.png', mime: 'image/png', buffer: new Uint8Array([1, 2]).buffer, sizeBytes: 2, previewKind: 'image' as const },
  ]),
}))
vi.mock('../../../src/converters/image-resize', () => ({
  imageResizeConverter: { id: 'image-resize', maxSizeMB: 50, convert },
}))
vi.mock('../../../src/lib/file-type', () => ({
  detectFileType: vi.fn(async (file: File) => ({ kind: 'image', mime: file.type, extension: 'png', detection: 'magic-bytes' })),
}))

URL.createObjectURL = vi.fn(() => 'blob:preview')
URL.revokeObjectURL = vi.fn()

/** Carga una imagen y simula el onLoad del <img> con dimensiones reales. */
async function load(natural: { width: number; height: number }, type = 'image/png', name = 'foto.png') {
  const view = render(<ResizePage />)
  const input = screen.getByTestId('resize-input')
  const file = new File(['bytes'], name, { type })
  file.slice = () => new Blob([]) as unknown as Blob
  fireEvent.change(input, { target: { files: [file] } })
  const preview = await screen.findByTestId('resize-preview')
  Object.defineProperty(preview, 'naturalWidth', { value: natural.width, configurable: true })
  Object.defineProperty(preview, 'naturalHeight', { value: natural.height, configurable: true })
  fireEvent.load(preview)
  await screen.findByTestId('resize-width')
  return view
}

const width = () => screen.getByTestId('resize-width') as HTMLInputElement
const height = () => screen.getByTestId('resize-height') as HTMLInputElement

describe('ResizePage', () => {
  it('parte del estado vacío con la invitación a elegir imagen', () => {
    render(<ResizePage />)
    expect(screen.getByTestId('resize-choose')).toBeTruthy()
    expect(screen.queryByTestId('resize-width')).toBeNull()
  })

  it('muestra las dimensiones originales y arranca dentro del tope (FR-003, FR-007)', async () => {
    await load({ width: 3000, height: 2000 })
    expect(screen.getByTestId('resize-source').textContent).toContain('3000 × 2000')
    expect(width().value).toBe('1620')
    expect(height().value).toBe('1080')
  })

  it('ajusta el otro eje en proporción al escribir (FR-005)', async () => {
    await load({ width: 3024, height: 4032 })
    fireEvent.change(width(), { target: { value: '1080' } })
    fireEvent.blur(width())
    expect(width().value).toBe('1080')
    expect(height().value).toBe('1440')
  })

  it('deja mover un eje sin tocar el otro con la proporción apagada (FR-006)', async () => {
    await load({ width: 800, height: 600 })
    fireEvent.click(screen.getByTestId('resize-linked'))
    fireEvent.change(height(), { target: { value: '500' } })
    fireEvent.blur(height())
    expect(width().value).toBe('800')
    expect(height().value).toBe('500')
  })

  it('recorta al máximo y sube al mínimo (FR-007)', async () => {
    await load({ width: 800, height: 600 })
    fireEvent.click(screen.getByTestId('resize-linked'))
    fireEvent.change(width(), { target: { value: '4000' } })
    fireEvent.blur(width())
    expect(width().value).toBe('1920')
    fireEvent.change(width(), { target: { value: '5' } })
    fireEvent.blur(width())
    expect(width().value).toBe('32')
  })

  it('avisa el fallback a PNG cuando el original no se puede codificar (FR-009)', async () => {
    await load({ width: 400, height: 300 }, 'image/gif', 'foto.gif')
    expect(screen.getByTestId('resize-fallback').textContent).toContain('GIF')
  })

  it('no avisa fallback cuando el original sí se puede codificar', async () => {
    await load({ width: 400, height: 300 })
    expect(screen.queryByTestId('resize-fallback')).toBeNull()
  })

  it('avisa al agrandar (FR-008)', async () => {
    await load({ width: 200, height: 150 })
    fireEvent.change(width(), { target: { value: '1000' } })
    fireEvent.blur(width())
    expect(screen.getByText(/puede verse borrosa/i)).toBeTruthy()
  })

  it('manda dimensiones exactas al conversor y ofrece la descarga', async () => {
    await load({ width: 1600, height: 1200 })
    fireEvent.change(screen.getByTestId('resize-format'), { target: { value: 'image/webp' } })
    fireEvent.click(screen.getByTestId('resize-go'))
    await waitFor(() => expect(convert).toHaveBeenCalled())
    expect(convert.mock.calls[0][2]).toMatchObject({ mime: 'image/webp', width: 1440, height: 1080 })
    expect((await screen.findByTestId('resize-download')).getAttribute('download')).toBe('foto-800x600.png')
  })

  it('avisa cuando el navegador no puede abrir el formato (FR-002)', async () => {
    render(<ResizePage />)
    const file = new File(['bytes'], 'raro.heic', { type: 'image/heic' })
    file.slice = () => new Blob([]) as unknown as Blob
    fireEvent.change(screen.getByTestId('resize-input'), { target: { files: [file] } })
    fireEvent.error(await screen.findByTestId('resize-preview'))
    expect(screen.getByRole('alert').textContent).toContain('no puede abrir este formato')
  })
})
