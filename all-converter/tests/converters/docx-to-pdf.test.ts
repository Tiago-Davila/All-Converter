import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { docxToPdfConverter } from '../../src/converters/docx-to-pdf'

const noop = () => {}
const signal = new AbortController().signal

describe('DOCX to PDF converter', () => {
  it('uses the Office limit', () => expect(docxToPdfConverter.maxSizeMB).toBe(25))

  it('declara la limitación de fidelidad parcial', () => {
    expect(docxToPdfConverter.limitation).toMatch(/fidelidad parcial/)
  })

  it('DOCX→PDF genera un PDF válido con el contenido', async () => {
    const file = new File([await readFile(new URL('../fixtures/sample.docx', import.meta.url))], 'sample.docx')
    const [result] = await docxToPdfConverter.convert(file, noop, {}, signal)
    expect(result.name).toBe('sample.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
  })
})
