import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { pdfToDocxConverter } from '../../src/converters/pdf-to-docx'
import { docxToPdfConverter } from '../../src/converters/docx-to-pdf'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
}
async function documentXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  return (await zip.file('word/document.xml')?.async('string')) ?? ''
}

describe('PDF to DOCX converter', () => {
  it('uses the PDF limit', () => expect(pdfToDocxConverter.maxSizeMB).toBe(25))

  it('PDF con texto→DOCX genera un documento válido', async () => {
    const [result] = await pdfToDocxConverter.convert(await fixture('text.pdf'), noop, {}, signal)
    expect(result.name).toBe('text.docx')
    expect(result.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(new TextDecoder().decode(result.buffer.slice(0, 2))).toBe('PK')
  })

  it('rechaza un PDF escaneado mencionando OCR', async () => {
    await expect(pdfToDocxConverter.convert(await fixture('scanned.pdf'), noop, {}, signal)).rejects.toThrow(/OCR/)
  })

  it('reconstruye una tabla de Word desde un PDF con tabla (round-trip DOCX→PDF→DOCX)', async () => {
    const [pdf] = await docxToPdfConverter.convert(await fixture('table.docx'), noop, {}, signal)
    const [result] = await pdfToDocxConverter.convert(new File([pdf.buffer], 'table.pdf'), noop, {}, signal)
    const xml = await documentXml(result.buffer)
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('Producto')
  })

  it('marca runs en negrita desde un PDF con fuente Bold', async () => {
    const [result] = await pdfToDocxConverter.convert(await fixture('text.pdf'), noop, {}, signal)
    const xml = await documentXml(result.buffer)
    expect(xml).toMatch(/<w:b\b/)
  })
})
