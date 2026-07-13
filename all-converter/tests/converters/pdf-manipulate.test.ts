import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { pdfMergeConverter, pdfRotateConverter, pdfSplitConverter } from '../../src/converters/pdf-manipulate'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
}
async function pageCount(buffer: ArrayBuffer): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount()
}

describe('PDF manipulation', () => {
  it('unir suma las páginas de todos los PDFs en orden', async () => {
    const main = await fixture('text.pdf')
    const extra = await fixture('scanned.pdf')
    const mainPdf = await PDFDocument.load(await main.arrayBuffer())
    const extraPdf = await PDFDocument.load(await extra.arrayBuffer())
    const expectedSizes = [...mainPdf.getPages(), ...extraPdf.getPages()].map((page) => page.getSize())
    const [result] = await pdfMergeConverter.convertMany!([main, extra], noop, {}, signal)
    expect(result.name).toBe('text-unido.pdf')
    const merged = await PDFDocument.load(result.buffer)
    expect(merged.getPages().map((page) => page.getSize())).toEqual(expectedSizes)
  })

  it('unir exige al menos dos archivos', async () => {
    await expect(pdfMergeConverter.convert(await fixture('text.pdf'), noop, {}, signal)).rejects.toThrow('al menos dos')
  })

  it('dividir genera un PDF por rango', async () => {
    const results = await pdfSplitConverter.convert(await fixture('text.pdf'), noop, { ranges: '1' }, signal)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('text-p1-1.pdf')
    await expect(pageCount(results[0].buffer)).resolves.toBe(1)
  })

  it('dividir rechaza rangos fuera del documento', async () => {
    await expect(pdfSplitConverter.convert(await fixture('text.pdf'), noop, { ranges: '1-999' }, signal)).rejects.toThrow('no existe')
  })

  it('rotar aplica el ángulo a las páginas', async () => {
    const [result] = await pdfRotateConverter.convert(await fixture('text.pdf'), noop, { degrees: 90 }, signal)
    const rotated = await PDFDocument.load(result.buffer)
    expect(rotated.getPage(0).getRotation().angle).toBe(90)
  })
})
