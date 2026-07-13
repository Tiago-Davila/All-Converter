// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '../../src/converters/types'
import { ConversionCard } from '../../src/components/ConversionCard'

const { convert } = vi.hoisted(() => ({ convert: vi.fn(async (_file: File, _progress: unknown, _options: Record<string, unknown>) => [{ name: 'foto.jpg', mime: 'image/jpeg', buffer: new Uint8Array([1, 2]).buffer, sizeBytes: 2, previewKind: 'image' as const }]) }))
vi.mock('../../src/converters/registry', () => ({
  getAvailableConverters: () => [{ id: 'image-convert', label: 'Convertir imagen', from: ['image'], to: 'png|jpg|webp', maxSizeMB: 50, convert }],
}))

URL.createObjectURL = vi.fn(() => 'blob:preview')
URL.revokeObjectURL = vi.fn()

const entry: FileEntry = { id: 'foto', file: new File(['png'], 'foto.png', { type: 'image/png' }), name: 'foto.png', sizeBytes: 3, detectedType: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' }, state: 'ready' }

describe('flujo individual', () => {
  it('envía calidad y ancho de imagen, y ofrece una vista previa antes de descargar', async () => {
    render(<ConversionCard entry={entry} />)
    fireEvent.change(screen.getByLabelText('Calidad'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('Ancho máximo'), { target: { value: '800' } })
    fireEvent.change(screen.getAllByLabelText('Formato destino')[0], { target: { value: 'jpg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Convertir' }))
    await waitFor(() => expect(convert).toHaveBeenCalled())
    expect(convert.mock.calls[0][2]).toMatchObject({ mime: 'image/jpeg', quality: 0.7, maxWidth: 800 })
    expect(screen.getByAltText('Vista previa de foto.jpg')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Descargar foto.jpg' })).toBeTruthy()
  })
})
