import type { ConversionProgress, ConversionResult } from '../converters/types'
import type { WorkerInput, WorkerOptions } from './types'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function progress(callback: (value: ConversionProgress) => void, percent: number, stage: string) { callback({ percent, stage }) }
function baseName(name: string) { return name.replace(/\.[^.]+$/, '') }
function decodeEntities(value: string): string { return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ') }
function cellText(html: string): string { return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() }

function isTabularJson(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
}

function decodeCsv(bytes: ArrayBuffer): { text: string; separator: string } {
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(bytes)
  const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 20)
  const separator = [',', ';', '\t', '|'].find((candidate) => { const counts = rows.map((row) => row.split(candidate).length); return counts[0] > 1 && counts.every((count) => count === counts[0]) })
  if (!separator) throw new Error('El CSV no tiene columnas consistentes. Reexportalo como UTF-8 con un delimitador válido.')
  return { text, separator }
}

async function spreadsheet(input: WorkerInput, options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const xlsx = await import('xlsx')
  const target = typeof options.target === 'string' ? options.target : 'csv'
  const isJson = input.name.toLowerCase().endsWith('.json') || input.mime === 'application/json'
  let workbook
  if (isJson) {
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(input.buffer)) } catch { throw new Error('El archivo no es un JSON válido.') }
    if (!isTabularJson(parsed)) throw new Error('El JSON no es tabular: se espera un array de objetos planos.')
    workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(parsed), 'Datos')
  } else if (input.name.toLowerCase().endsWith('.csv') || input.mime === 'text/csv') {
    const csv = decodeCsv(input.buffer); workbook = xlsx.read(csv.text, { type: 'string', FS: csv.separator })
  } else workbook = xlsx.read(input.buffer, { type: 'array' })
  progress(onProgress, 50, 'Datos leídos')
  const base = baseName(input.name)
  if (target === 'xlsx') {
    const buffer: ArrayBuffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })
    return [{ name: `${base}.xlsx`, mime: XLSX_MIME, buffer, sizeBytes: buffer.byteLength }]
  }
  const results = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const output = target === 'json' ? JSON.stringify(xlsx.utils.sheet_to_json(sheet, { defval: null })) : xlsx.utils.sheet_to_csv(sheet)
    const buffer = new TextEncoder().encode(output).buffer
    return { name: workbook.SheetNames.length === 1 ? `${base}.${target}` : `${base}-${sheetName}.${target}`, mime: target === 'json' ? 'application/json' : 'text/csv', buffer, sizeBytes: buffer.byteLength }
  })
  progress(onProgress, 100, 'Completado'); return results
}

async function spreadsheetPdf(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const [{ jsPDF }, { default: autoTable }, xlsx] = await Promise.all([import('jspdf'), import('jspdf-autotable'), import('xlsx')])
  const workbook = xlsx.read(input.buffer, { type: 'array' })
  if (!workbook.SheetNames.length) throw new Error('La planilla no contiene hojas.')
  const pdf = new jsPDF()
  workbook.SheetNames.forEach((sheetName, index) => {
    if (index > 0) pdf.addPage()
    const rows = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, defval: '' })
    pdf.setFontSize(12); pdf.text(sheetName, 14, 14)
    autoTable(pdf, { startY: 20, head: [rows[0] ?? []], body: rows.slice(1), styles: { overflow: 'linebreak', cellWidth: 'wrap' }, horizontalPageBreak: true })
    progress(onProgress, Math.round((index + 1) / workbook.SheetNames.length * 90), `Hoja ${index + 1} de ${workbook.SheetNames.length}`)
  })
  const buffer = pdf.output('arraybuffer'); progress(onProgress, 100, 'PDF creado')
  return [{ name: `${baseName(input.name)}.pdf`, mime: 'application/pdf', buffer, sizeBytes: buffer.byteLength, previewKind: 'pdf' }]
}

async function docxText(input: WorkerInput, options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const mammoth = await import('mammoth'); const target = typeof options.target === 'string' ? options.target : 'txt'
  progress(onProgress, 40, 'Leyendo documento')
  const converted = target === 'html' ? await mammoth.convertToHtml({ arrayBuffer: input.buffer }) : await mammoth.extractRawText({ arrayBuffer: input.buffer })
  let output = converted.value
  if (!output.trim()) throw new Error('El documento no contiene texto extraíble.')
  if (target === 'html') output = `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>${input.name}</title></head><body>${output}</body></html>\n`
  const buffer = new TextEncoder().encode(output).buffer; progress(onProgress, 100, 'Completado')
  return [{ name: `${baseName(input.name)}.${target}`, mime: target === 'html' ? 'text/html' : 'text/plain', buffer, sizeBytes: buffer.byteLength }]
}

async function docxPdf(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const [mammoth, { jsPDF }] = await Promise.all([import('mammoth'), import('jspdf')]); progress(onProgress, 30, 'Leyendo documento')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: input.buffer })
  const blocks = [...html.matchAll(/<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => ({ tag: match[1].toLowerCase(), text: cellText(match[2]) })).filter((block) => block.text)
  if (!blocks.length) throw new Error('El documento no contiene texto extraíble.')
  const pdf = new jsPDF(); const pageHeight = pdf.internal.pageSize.getHeight(); const textWidth = pdf.internal.pageSize.getWidth() - 30; let y = 20
  for (const block of blocks) { const size = block.tag === 'h1' ? 18 : block.tag === 'h2' || block.tag === 'h3' ? 14 : 11; pdf.setFontSize(size); pdf.setFont('helvetica', block.tag.startsWith('h') ? 'bold' : 'normal'); const lines: string[] = pdf.splitTextToSize(block.tag === 'li' ? `• ${block.text}` : block.text, textWidth); for (const line of lines) { if (y > pageHeight - 20) { pdf.addPage(); y = 20 } pdf.text(line, 15, y); y += size * 0.5 } y += size * 0.35 }
  const buffer = pdf.output('arraybuffer'); progress(onProgress, 100, 'PDF creado')
  return [{ name: `${baseName(input.name)}.pdf`, mime: 'application/pdf', buffer, sizeBytes: buffer.byteLength, previewKind: 'pdf' }]
}

async function docxXlsx(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const [mammoth, xlsx] = await Promise.all([import('mammoth'), import('xlsx')]); progress(onProgress, 30, 'Leyendo documento')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: input.buffer })
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((table) => [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1]))))
  if (!tables.length) throw new Error('El documento no contiene tablas.')
  const workbook = xlsx.utils.book_new(); tables.forEach((rows, index) => xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), `Tabla${index + 1}`))
  const buffer: ArrayBuffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' }); progress(onProgress, 100, 'Completado')
  return [{ name: `${baseName(input.name)}.xlsx`, mime: XLSX_MIME, buffer, sizeBytes: buffer.byteLength }]
}

export async function executeOfficeOperation(operation: string, input: WorkerInput, options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  if (operation === 'spreadsheet-convert') return spreadsheet(input, options, onProgress)
  if (operation === 'spreadsheet-to-pdf') return spreadsheetPdf(input, onProgress)
  if (operation === 'docx-text') return docxText(input, options, onProgress)
  if (operation === 'docx-to-pdf') return docxPdf(input, onProgress)
  if (operation === 'docx-to-xlsx') return docxXlsx(input, onProgress)
  throw new Error(`Operación Office desconocida: ${operation}.`)
}
