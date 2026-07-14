import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { docxToXlsxConverter } from '../../src/converters/docx-to-xlsx'
import { loadSheetJs } from '../../src/lib/sheetjs'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
}

describe('DOCX to XLSX converter', () => {
  it('uses the Office limit', () => expect(docxToXlsxConverter.maxSizeMB).toBe(25))

  it('extrae las tablas del documento, una hoja por tabla', async () => {
    const [result] = await docxToXlsxConverter.convert(await fixture('table.docx'), noop, {}, signal)
    expect(result.name).toBe('table.xlsx')
    const xlsx = await loadSheetJs()
    const workbook = xlsx.read(result.buffer, { type: 'array' })
    expect(workbook.SheetNames.length).toBeGreaterThan(0)
    expect(workbook.SheetNames[0]).toBe('Tabla1')
    const rows = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets.Tabla1, { header: 1 })
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]).toContain('Producto')
  })

  it('rechaza documentos sin tablas con mensaje específico', async () => {
    await expect(docxToXlsxConverter.convert(await fixture('notables.docx'), noop, {}, signal)).rejects.toThrow('no contiene tablas')
  })
})
