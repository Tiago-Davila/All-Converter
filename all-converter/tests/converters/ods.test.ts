import { describe, expect, it } from 'vitest'
import { spreadsheetToPdfConverter } from '../../src/converters/spreadsheet-to-pdf'
import { spreadsheetConverter } from '../../src/converters/spreadsheet'
import { buildOds } from '../helpers/odf'
import { loadSheetJs } from '../../src/lib/sheetjs'

const noop = () => {}
const signal = new AbortController().signal
const rows = [['Producto', 'Precio'], ['Cafe', '100']]
const odsFile = async () => new File([await buildOds(rows)], 'datos.ods')

describe('ODS (LibreOffice Calc)', () => {
  it('ODS→PDF genera un PDF válido', async () => {
    const [result] = await spreadsheetToPdfConverter.convert(await odsFile(), noop, {}, signal)
    expect(result.name).toBe('datos.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
  })

  it('ODS→CSV conserva el contenido', async () => {
    const [result] = await spreadsheetConverter.convert(await odsFile(), noop, { target: 'csv' }, signal)
    expect(result.name).toBe('datos.csv')
    expect(new TextDecoder().decode(result.buffer)).toContain('Producto')
  })

  it('ODS→XLSX se relee con SheetJS', async () => {
    const [result] = await spreadsheetConverter.convert(await odsFile(), noop, { target: 'xlsx' }, signal)
    expect(result.name).toBe('datos.xlsx')
    const xlsx = await loadSheetJs()
    const workbook = xlsx.read(result.buffer, { type: 'array' })
    const parsed = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })
    expect(parsed[0]).toContain('Producto')
  })

  it('el selector de destino no ofrece el formato de origen', () => {
    expect(spreadsheetConverter.targetsFor?.({ kind: 'spreadsheet', mime: '', extension: 'ods', detection: 'extension' })).toEqual(['csv', 'json', 'xlsx'])
    expect(spreadsheetConverter.targetsFor?.({ kind: 'spreadsheet', mime: '', extension: 'xlsx', detection: 'extension' })).toEqual(['csv', 'json'])
  })
})
