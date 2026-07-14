import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { pdfTextConverter, pdfToImagesConverter } from '../../src/converters/pdf-extract'

// Shim mínimo de OffscreenCanvas sobre @napi-rs/canvas (dependencia opcional de pdfjs) para renderizar en Node.
class NodeOffscreenCanvas {
  private readonly canvas: Canvas
  constructor(width: number, height: number) { this.canvas = createCanvas(width, height) }
  getContext(kind: '2d') { return this.canvas.getContext(kind) }
  async convertToBlob({ type }: { type?: string; quality?: number } = {}): Promise<Blob> {
    const mime = type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const buffer = mime === 'image/jpeg' ? this.canvas.toBuffer('image/jpeg') : this.canvas.toBuffer('image/png')
    return new Blob([new Uint8Array(buffer)], { type: mime })
  }
}
;(globalThis as Record<string, unknown>).OffscreenCanvas ??= NodeOffscreenCanvas

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
}

describe('PDF extraction', () => {
  it('uses the PDF limit', () => expect(pdfTextConverter.maxSizeMB).toBe(25))

  it('PDF→TXT extrae el texto del fixture', async () => {
    const [result] = await pdfTextConverter.convert(await fixture('text.pdf'), noop, {}, signal)
    expect(result.name).toBe('text.txt')
    expect(result.mime).toBe('text/plain')
    expect(new TextDecoder().decode(result.buffer).trim().length).toBeGreaterThan(0)
  })

  it('PDF→TXT rechaza un escaneo sin capa de texto mencionando OCR', async () => {
    await expect(pdfTextConverter.convert(await fixture('scanned.pdf'), noop, {}, signal)).rejects.toThrow(/OCR/)
  })

  it('PDF→PNG genera una imagen válida por página', async () => {
    const results = await pdfToImagesConverter.convert(await fixture('text.pdf'), noop, { target: 'png' }, signal)
    expect(results.length).toBeGreaterThan(0)
    for (const [index, result] of results.entries()) {
      expect(result.name).toBe(`text-p${index + 1}.png`)
      expect(result.mime).toBe('image/png')
      expect([...new Uint8Array(result.buffer.slice(0, 4))]).toEqual([0x89, 0x50, 0x4e, 0x47])
    }
  })

  it('PDF→JPG produce JPEG', async () => {
    const [result] = await pdfToImagesConverter.convert(await fixture('text.pdf'), noop, { target: 'jpg' }, signal)
    expect(result.mime).toBe('image/jpeg')
    expect([...new Uint8Array(result.buffer.slice(0, 2))]).toEqual([0xff, 0xd8])
  })
})
