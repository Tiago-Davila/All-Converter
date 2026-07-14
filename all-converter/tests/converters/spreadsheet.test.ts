import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { spreadsheetConverter } from '../../src/converters/spreadsheet'
import { loadSheetJs } from '../../src/lib/sheetjs'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string, type = ''): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name, { type })
}

describe('spreadsheet converter', () => {
  it('uses the Office limit', () => expect(spreadsheetConverter.maxSizeMB).toBe(25))

  it('XLSX→CSV conserva las filas de cada hoja', async () => {
    const results = await spreadsheetConverter.convert(await fixture('sample.xlsx'), noop, { target: 'csv' }, signal)
    const xlsx = await loadSheetJs()
    const workbook = xlsx.read(await readFile(new URL('../fixtures/sample.xlsx', import.meta.url)), { type: 'buffer' })
    expect(results).toHaveLength(workbook.SheetNames.length)
    const expected = xlsx.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
    expect(new TextDecoder().decode(results[0].buffer)).toBe(expected)
  })

  it('XLSX→JSON usa la primera fila como claves', async () => {
    const [result] = await spreadsheetConverter.convert(await fixture('sample.xlsx'), noop, { target: 'json' }, signal)
    const rows: unknown = JSON.parse(new TextDecoder().decode(result.buffer))
    expect(Array.isArray(rows)).toBe(true)
    expect((rows as object[]).length).toBeGreaterThan(0)
  })

  it('XLSX multihoja genera un archivo por hoja', async () => {
    const results = await spreadsheetConverter.convert(await fixture('multisheet.xlsx'), noop, { target: 'csv' }, signal)
    expect(results.map((r) => r.name)).toEqual(['multisheet-Ventas.csv', 'multisheet-Totales.csv'])
    expect(new TextDecoder().decode(results[0].buffer)).toContain('cafe')
  })

  it('CSV→XLSX produce una planilla legible con los mismos datos', async () => {
    const [result] = await spreadsheetConverter.convert(await fixture('sample.csv', 'text/csv'), noop, { target: 'xlsx' }, signal)
    const xlsx = await loadSheetJs()
    const workbook = xlsx.read(result.buffer, { type: 'array' })
    const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]])
    const original = (await readFile(new URL('../fixtures/sample.csv', import.meta.url), 'utf8')).trim().split('\n')[0]
    expect(result.name).toBe('sample.xlsx')
    expect(csv.trim().split('\n')[0]).toBe(original.trim())
  })

  it('JSON tabular→XLSX conserva filas y claves', async () => {
    const [result] = await spreadsheetConverter.convert(await fixture('sample.json', 'application/json'), noop, { target: 'xlsx' }, signal)
    const xlsx = await loadSheetJs()
    const workbook = xlsx.read(result.buffer, { type: 'array' })
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ nombre: 'Ada', rol: 'ingeniera' })
  })

  it('rechaza JSON no tabular con mensaje específico', async () => {
    const file = new File(['{"a":1}'], 'objeto.json', { type: 'application/json' })
    await expect(spreadsheetConverter.convert(file, noop, { target: 'xlsx' }, signal)).rejects.toThrow('no es tabular')
  })

  it('rechaza JSON con objetos o arrays anidados', async () => {
    const file = new File(['[{"nombre":"Ada","meta":{"rol":"ingeniera"}}]'], 'anidado.json', { type: 'application/json' })
    await expect(spreadsheetConverter.convert(file, noop, { target: 'xlsx' }, signal)).rejects.toThrow('objetos planos')
  })
})
