import type { Converter } from './types'
import { loadSheetJs } from '../lib/sheetjs'

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export const docxToXlsxConverter: Converter = { id: 'docx-to-xlsx', label: 'DOCX a XLSX', from: ['document'], to: 'xlsx', maxSizeMB: 25,
  async convert(file, onProgress, _options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const [mammoth, xlsx] = await Promise.all([import('mammoth'), loadSheetJs()])
    onProgress({ percent: 30, stage: 'Leyendo documento' })
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((tableMatch) =>
      [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
        [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cellMatch) => cellText(cellMatch[1]))))
    if (!tables.length) throw new Error('El documento no contiene tablas.')
    onProgress({ percent: 70, stage: 'Generando planilla' })
    const workbook = xlsx.utils.book_new()
    tables.forEach((rows, index) => xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), `Tabla${index + 1}`))
    const output: ArrayBuffer = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' })
    onProgress({ percent: 100, stage: 'Completado' })
    return [{ name: file.name.replace(/\.docx$/i, '.xlsx'), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: output, sizeBytes: output.byteLength }]
  }
}
