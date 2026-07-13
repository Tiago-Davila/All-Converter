import type { PDFDocument as PdfLibDocument } from 'pdf-lib'
import type { ConversionProgress, ConversionResult } from '../converters/types'
import { loadPdfJs } from '../lib/pdfjs'
import type { WorkerInput, WorkerOptions } from './types'

const SCANNED_ERROR = 'El PDF parece ser un escaneo sin texto seleccionable; convertirlo requeriría OCR, que está fuera del alcance de esta versión.'
const report = (callback: (value: ConversionProgress) => void, percent: number, stage: string) => callback({ percent, stage })
const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

function pdfLoadError(error: unknown): Error {
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException') return new Error('El PDF está protegido con contraseña. Desbloquealo antes de convertirlo.')
  if (name === 'InvalidPDFException') return new Error('El archivo parece estar dañado o incompleto. Descargalo nuevamente e intentá otra vez.')
  return error instanceof Error ? error : new Error('No se pudo abrir el PDF. Verificá que el archivo sea válido.')
}

async function openPdf(input: WorkerInput) {
  try { const pdfjs = await loadPdfJs(); return await pdfjs.getDocument({ data: input.buffer }).promise } catch (error) { throw pdfLoadError(error) }
}

async function pdfText(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const pdf = await openPdf(input); let text = ''
  for (let page = 1; page <= pdf.numPages; page++) { text += (await (await pdf.getPage(page)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ') + '\n'; report(onProgress, Math.round(page / pdf.numPages * 100), `Página ${page} de ${pdf.numPages}`) }
  if (!text.trim()) throw new Error(SCANNED_ERROR)
  const buffer = new TextEncoder().encode(text).buffer
  return [{ name: `${baseName(input.name)}.txt`, mime: 'text/plain', buffer, sizeBytes: buffer.byteLength }]
}

async function pdfImages(input: WorkerInput, options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const pdf = await openPdf(input); const target = options.target === 'jpg' ? 'jpg' : 'png'; const mime = target === 'jpg' ? 'image/jpeg' : 'image/png'; const results: ConversionResult[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale: 2 }); const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)); const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo preparar el lienzo para renderizar el PDF.')
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
    const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 }); const buffer = await blob.arrayBuffer(); results.push({ name: `${baseName(input.name)}-p${pageNumber}.${target}`, mime, buffer, sizeBytes: buffer.byteLength, previewKind: 'image' }); report(onProgress, Math.round(pageNumber / pdf.numPages * 100), `Página ${pageNumber} de ${pdf.numPages}`)
  }
  return results
}

async function pdfDocx(input: WorkerInput, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const pdf = await openPdf(input); const lines: Array<{ text: string; fontSize: number }> = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) { const content = await (await pdf.getPage(pageNumber)).getTextContent(); const rows = new Map<number, { text: string[]; fontSize: number }>(); for (const item of content.items) { if (!('str' in item) || !item.str.trim()) continue; const y = Math.round(item.transform[5]); const fontSize = Math.abs(item.transform[3]) || item.height; const row = rows.get(y) ?? { text: [], fontSize }; row.text.push(item.str); row.fontSize = Math.max(row.fontSize, fontSize); rows.set(y, row) } for (const [, row] of [...rows.entries()].sort(([a], [b]) => b - a)) lines.push({ text: row.text.join(' ').trim(), fontSize: row.fontSize }); report(onProgress, Math.round(pageNumber / pdf.numPages * 80), `Leyendo página ${pageNumber} de ${pdf.numPages}`) }
  if (!lines.length) throw new Error(SCANNED_ERROR)
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx'); const sizes = lines.map((line) => line.fontSize).sort((a, b) => a - b); const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 0
  const paragraphs = lines.map((line) => new Paragraph({ heading: line.fontSize >= bodySize * 1.5 ? HeadingLevel.HEADING_1 : line.fontSize >= bodySize * 1.2 ? HeadingLevel.HEADING_2 : undefined, children: [new TextRun(line.text)] }))
  const blob = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] })); const buffer = await blob.arrayBuffer(); report(onProgress, 100, 'DOCX creado')
  return [{ name: `${baseName(input.name)}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer, sizeBytes: buffer.byteLength }]
}

function parseRanges(input: string, pageCount: number): Array<[number, number]> { const ranges = input.split(',').map((part) => part.trim()).filter(Boolean).map((part): [number, number] => { const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part); if (!match) throw new Error(`Rango inválido: "${part}".`); const start = Number(match[1]); const end = Number(match[2] ?? match[1]); if (start < 1 || end > pageCount || start > end) throw new Error(`El rango "${part}" no existe en un PDF de ${pageCount} páginas.`); return [start, end] }); if (!ranges.length) throw new Error('Indicá al menos un rango de páginas.'); return ranges }
async function savePdf(pdf: PdfLibDocument, name: string): Promise<ConversionResult> { const output = new Uint8Array(await pdf.save()); return { name, mime: 'application/pdf', buffer: output.buffer, sizeBytes: output.byteLength, previewKind: 'pdf' } }

async function manipulate(operation: string, inputs: WorkerInput[], options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const { PDFDocument, degrees } = await import('pdf-lib'); const input = inputs[0]; if (!input) throw new Error('Falta el PDF de entrada.')
  if (operation === 'pdf-merge') { if (inputs.length < 2) throw new Error('Para unir PDFs se necesitan al menos dos archivos.'); const merged = await PDFDocument.create(); for (const [index, source] of inputs.entries()) { const doc = await PDFDocument.load(source.buffer); for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page); report(onProgress, Math.round((index + 1) / inputs.length * 100), `Uniendo ${source.name}`) } return [await savePdf(merged, `${baseName(input.name)}-unido.pdf`)] }
  const source = await PDFDocument.load(input.buffer)
  if (operation === 'pdf-split') { const ranges = parseRanges(typeof options.ranges === 'string' ? options.ranges : '', source.getPageCount()); const results: ConversionResult[] = []; for (const [index, [start, end]] of ranges.entries()) { const part = await PDFDocument.create(); const pages = await part.copyPages(source, Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset)); pages.forEach((page) => part.addPage(page)); results.push(await savePdf(part, `${baseName(input.name)}-p${start}-${end}.pdf`)); report(onProgress, Math.round((index + 1) / ranges.length * 100), `Rango ${start}-${end}`) } return results }
  if (operation === 'pdf-rotate') { const angle = typeof options.degrees === 'number' ? options.degrees : 90; if (![90, 180, 270].includes(angle)) throw new Error('La rotación debe ser de 90, 180 o 270 grados.'); const selected = Array.isArray(options.pages) ? options.pages.map(Number) : null; source.getPages().forEach((page, index) => { if (!selected || selected.includes(index + 1)) page.setRotation(degrees((page.getRotation().angle + angle) % 360)) }); report(onProgress, 100, 'Páginas rotadas'); return [await savePdf(source, `${baseName(input.name)}-rotado.pdf`)] }
  throw new Error(`Operación PDF de escritura desconocida: ${operation}.`)
}

async function imagesPdf(inputs: WorkerInput[], onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> { const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.create(); for (const [index, input] of inputs.entries()) { const image = input.mime === 'image/png' ? await pdf.embedPng(input.buffer) : await pdf.embedJpg(input.buffer); const page = pdf.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height }); report(onProgress, Math.round((index + 1) / inputs.length * 100), `Imagen ${index + 1} de ${inputs.length}`) } const result = await savePdf(pdf, `${baseName(inputs[0].name)}.pdf`); return [result] }

export async function executePdfOperation(operation: string, inputs: WorkerInput[], options: WorkerOptions, onProgress: (value: ConversionProgress) => void): Promise<ConversionResult[]> {
  const input = inputs[0]; if (!input) throw new Error('Falta el archivo de entrada.')
  if (operation === 'pdf-to-txt') return pdfText(input, onProgress)
  if (operation === 'pdf-to-images') return pdfImages(input, options, onProgress)
  if (operation === 'pdf-to-docx') return pdfDocx(input, onProgress)
  if (operation === 'images-to-pdf') return imagesPdf(inputs, onProgress)
  return manipulate(operation, inputs, options, onProgress)
}
