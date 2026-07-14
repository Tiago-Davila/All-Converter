import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { imagesToPdfConverter } from '../../src/converters/images-to-pdf'

async function fixture(name = 'sample.png') { return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name, { type: 'image/png' }) }

describe('images to PDF', () => {
  it('combina múltiples imágenes en un único PDF preservando el orden', async () => {
    const files = [await fixture('sample.png'), await fixture('images.png')]
    const [result] = await imagesToPdfConverter.convertMany!(files, () => {}, {}, new AbortController().signal)
    expect(result.name).toBe('sample.pdf')
    expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(2)
  })
  it('rasteriza WebP localmente antes de insertarlo en PDF', async () => {
    const png = await readFile(new URL('../fixtures/sample.png', import.meta.url))
    const webp = new File([await readFile(new URL('../fixtures/animated.webp', import.meta.url))], 'sample.webp', { type: 'image/webp' })
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close })))
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return { drawImage: vi.fn() } }
      async convertToBlob() { return new Blob([png], { type: 'image/png' }) }
    })
    const [result] = await imagesToPdfConverter.convert(webp, () => {}, {}, new AbortController().signal)
    expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(1)
    expect(close).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
