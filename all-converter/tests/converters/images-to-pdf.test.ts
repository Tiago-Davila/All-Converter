import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { imagesToPdfConverter } from '../../src/converters/images-to-pdf'

async function fixture(name = 'sample.png') { return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name, { type: 'image/png' }) }

describe('images to PDF', () => {
  it('combina múltiples imágenes en un único PDF preservando el orden', async () => {
    const files = [await fixture('sample.png'), await fixture('images.png')]
    const [result] = await imagesToPdfConverter.convertMany!(files, () => {}, {}, new AbortController().signal)
    expect(result.name).toBe('sample.pdf')
    expect((await PDFDocument.load(result.buffer)).getPageCount()).toBe(2)
  })
  it.todo('rasteriza WebP antes de insertarlo en PDF')
})
