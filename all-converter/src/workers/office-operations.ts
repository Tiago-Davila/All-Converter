import type { ConversionProgress, ConversionResult } from '../converters/types'
import type { WorkerInput, WorkerOptions } from './types'
import { decodeCsv, isFlatTabularJson } from './tabular'
import { htmlToBlocks, imageSize, parseHtmlTableRows, renderBlocksToPdf, odfContentToBlocks, imageBlockFromBytes, type DisplayLookup, type OdfImageResolver } from './office-doc-render'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function progress(callback: (value: ConversionProgress) => void, percent: number, stage: string) { callback({ percent, stage }) }
function baseName(name: string) { return name.replace(/\.[^.]+$/, '') }

async function spreadsheet(input: WorkerInput, options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const xlsx = await import('xlsx')
  const target = typeof options.target === 'string' ? options.target : 'csv'
  const isJson = input.name.toLowerCase().endsWith('.json') || input.mime === 'application/json'
  let workbook
  if (isJson) {
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder().decode(input.buffer)) } catch { throw new Error('El archivo no es un JSON válido.') }
    if (!isFlatTabularJson(parsed)) throw new Error('El JSON no es tabular: se espera un array de objetos planos con valores escalares.')
    workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(parsed), 'Datos')
  } else if (input.name.toLowerCase().endsWith('.csv') || input.mime === 'text/csv') {
    const csv = decodeCsv(input.buffer); workbook = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(csv.rows), 'Datos')
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

/**
 * Tamaño de visualización de las imágenes del DOCX.
 *
 * mammoth entrega los bytes pero descarta el tamaño, así que se abre el paquete en
 * paralelo para leer los `wp:extent` de `word/document.xml`. Si el zip no se puede leer,
 * se devuelve un lookup vacío: el renderizador degrada a los píxeles intrínsecos en vez
 * de abortar la conversión (spec 005, FR-005).
 */
async function docxDisplayLookup(buffer: ArrayBuffer): Promise<DisplayLookup> {
  try {
    const JSZip = (await import('jszip')).default
    const { extractDocxImageSizes } = await import('./docx-image-size')
    return await extractDocxImageSizes(await JSZip.loadAsync(buffer), imageSize)
  } catch {
    return () => undefined
  }
}

async function docxPdf(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const mammoth = await import('mammoth'); progress(onProgress, 25, 'Leyendo documento')
  const [{ value: html }, resolveDisplay] = await Promise.all([
    mammoth.convertToHtml({ arrayBuffer: input.buffer }),
    docxDisplayLookup(input.buffer),
  ])
  progress(onProgress, 50, 'Midiendo imágenes')
  const blocks = htmlToBlocks(html, resolveDisplay)
  if (!blocks.length) throw new Error('El documento no contiene texto extraíble.')
  progress(onProgress, 70, 'Componiendo PDF')
  const result = await renderBlocksToPdf(blocks, baseName(input.name)); progress(onProgress, 100, 'PDF creado')
  return [result]
}

async function odtPdf(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const JSZip = (await import('jszip')).default; progress(onProgress, 25, 'Abriendo documento')
  const zip = await JSZip.loadAsync(input.buffer)
  const contentFile = zip.file('content.xml')
  if (!contentFile) throw new Error('El archivo ODT no es válido: falta content.xml.')
  const xml = await contentFile.async('string'); progress(onProgress, 50, 'Leyendo contenido')
  const pictures = new Map<string, Uint8Array>()
  await Promise.all(Object.keys(zip.files).filter((name) => /^Pictures\//i.test(name)).map(async (name) => { pictures.set(name, await zip.files[name].async('uint8array')) }))
  const resolveImage: OdfImageResolver = (href) => {
    const bytes = pictures.get(href) ?? pictures.get(href.replace(/^\.?\//, ''))
    return bytes ? imageBlockFromBytes(bytes, href) : undefined
  }
  const blocks = odfContentToBlocks(xml, resolveImage)
  if (!blocks.length) throw new Error('El documento no contiene texto extraíble.')
  progress(onProgress, 75, 'Componiendo PDF')
  const result = await renderBlocksToPdf(blocks, baseName(input.name)); progress(onProgress, 100, 'PDF creado')
  return [result]
}

async function mdPdf(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const { markdownToBlocks } = await import('./markdown-parse'); progress(onProgress, 40, 'Leyendo Markdown')
  const blocks = markdownToBlocks(new TextDecoder().decode(input.buffer))
  if (!blocks.length) throw new Error('El archivo no contiene contenido convertible.')
  progress(onProgress, 70, 'Componiendo PDF')
  const result = await renderBlocksToPdf(blocks, baseName(input.name)); progress(onProgress, 100, 'PDF creado')
  return [result]
}

async function docxXlsx(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const [mammoth, xlsx] = await Promise.all([import('mammoth'), import('xlsx')]); progress(onProgress, 30, 'Leyendo documento')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: input.buffer })
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((table) => parseHtmlTableRows(table[1]))
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
  if (operation === 'odt-to-pdf') return odtPdf(input, onProgress)
  if (operation === 'md-to-pdf') return mdPdf(input, onProgress)
  if (operation === 'docx-to-xlsx') return docxXlsx(input, onProgress)
  throw new Error(`Operación Office desconocida: ${operation}.`)
}
