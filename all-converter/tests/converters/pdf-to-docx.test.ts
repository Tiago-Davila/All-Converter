import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { pdfToDocxConverter } from '../../src/converters/pdf-to-docx'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
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
})
