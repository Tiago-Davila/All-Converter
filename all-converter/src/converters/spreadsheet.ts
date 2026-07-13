import type { ConversionResult, Converter } from './types'
import { loadSheetJs } from '../lib/sheetjs'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function isTabularJson(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
}

function decodeCsv(bytes: ArrayBuffer): { text: string; separator: string } {
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(bytes)
  if (text.includes('\uFFFD')) throw new Error('El CSV no se puede leer. Reexportalo como UTF-8.')
  const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 20)
  const separator = [',', ';', '\t', '|'].find((candidate) => {
    const counts = rows.map((row) => row.split(candidate).length)
    return counts[0] > 1 && counts.every((count) => count === counts[0])
  })
  if (!separator) throw new Error('El CSV no tiene columnas consistentes. Reexportalo como UTF-8 con un delimitador válido.')
  return { text, separator }
}

export const spreadsheetConverter: Converter = { id: 'spreadsheet-convert', label: 'Convertir planilla', from: ['spreadsheet'], to: 'csv|json|xlsx', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const xlsx = await loadSheetJs()
    const target = String(options.target ?? 'csv')
    const isJsonInput = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json'
    let workbook
    if (isJsonInput) {
      let parsed: unknown
      try { parsed = JSON.parse(await file.text()) } catch { throw new Error('El archivo no es un JSON válido.') }
      if (!isTabularJson(parsed)) throw new Error('El JSON no es tabular: se espera un array de objetos planos.')
      workbook = xlsx.utils.book_new()
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(parsed), 'Datos')
    } else if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
      const csv = decodeCsv(await file.arrayBuffer())
      workbook = xlsx.read(csv.text, { type: 'string', FS: csv.separator })
    } else {
      workbook = xlsx.read(await file.arrayBuffer(), { type: 'array' })
    }
    onProgress({ percent: 50, stage: 'Datos leídos' })
    const base = file.name.replace(/\.[^.]+$/, '')
    let results: ConversionResult[]
    if (target === 'xlsx') {
      const output: ArrayBuffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })
      results = [{ name: `${base}.xlsx`, mime: XLSX_MIME, buffer: output, sizeBytes: output.byteLength }]
    } else {
      results = workbook.SheetNames.map((sheetName) => {
        const sheet = workbook.Sheets[sheetName]
        const output = target === 'json' ? JSON.stringify(xlsx.utils.sheet_to_json(sheet, { defval: null })) : xlsx.utils.sheet_to_csv(sheet)
        const buffer = new TextEncoder().encode(output).buffer
        return { name: workbook.SheetNames.length === 1 ? `${base}.${target}` : `${base}-${sheetName}.${target}`, mime: target === 'json' ? 'application/json' : 'text/csv', buffer, sizeBytes: buffer.byteLength }
      })
    }
    onProgress({ percent: 100, stage: 'Completado' })
    return results
  }
}
