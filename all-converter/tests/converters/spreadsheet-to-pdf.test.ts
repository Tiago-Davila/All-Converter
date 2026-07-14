import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { spreadsheetToPdfConverter } from '../../src/converters/spreadsheet-to-pdf'
import { PDFDocument } from 'pdf-lib'

const signal = new AbortController().signal

describe('spreadsheet to PDF converter', () => {
  it('uses the Office limit', () => expect(spreadsheetToPdfConverter.maxSizeMB).toBe(25))

  it('XLSX→PDF genera un PDF válido con tabla', async () => {
    const file = new File([await readFile(new URL('../fixtures/sample.xlsx', import.meta.url))], 'sample.xlsx')
    const [result] = await spreadsheetToPdfConverter.convert(file, () => {}, {}, signal)
    expect(result.name).toBe('sample.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
  })

  it('incluye todas las hojas de un XLSX multihoja', async () => {
    const file = new File([await readFile(new URL('../fixtures/multisheet.xlsx', import.meta.url))], 'multisheet.xlsx')
    const [result] = await spreadsheetToPdfConverter.convert(file, () => {}, {}, new AbortController().signal)
    expect((await PDFDocument.load(result.buffer)).getPageCount()).toBeGreaterThanOrEqual(2)
  })
})
