import { loadPdfJs } from '../lib/pdfjs'
import type { ConversionResult, Converter } from './types'

export const SCANNED_PDF_ERROR = 'El PDF parece ser un escaneo sin texto seleccionable; convertirlo requeriría OCR, que está fuera del alcance de esta versión.'

export const pdfTextConverter: Converter = { id: 'pdf-to-txt', label: 'PDF a TXT', from: ['pdf'], to: 'txt', maxSizeMB: 25, async convert(file, progress, _options, signal) { if (signal.aborted) throw new DOMException('Cancelado', 'AbortError'); const pdfjs = await loadPdfJs(); const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; let text = ''; for (let page = 1; page <= pdf.numPages; page++) { text += (await (await pdf.getPage(page)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ') + '\n' } if (!text.trim()) throw new Error(SCANNED_PDF_ERROR); progress({ percent: 100, stage: 'Texto extraído' }); const buffer = new TextEncoder().encode(text).buffer; return [{ name: file.name.replace(/\.pdf$/i, '.txt'), mime: 'text/plain', buffer, sizeBytes: buffer.byteLength }] } }

export const pdfToImagesConverter: Converter = { id: 'pdf-to-images', label: 'PDF a imágenes', from: ['pdf'], to: 'png|jpg', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const pdfjs = await loadPdfJs()
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    const target = String(options.target ?? 'png')
    const mime = target === 'jpg' ? 'image/jpeg' : 'image/png'
    const base = file.name.replace(/\.pdf$/i, '')
    const results: ConversionResult[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No se pudo preparar el lienzo para renderizar el PDF.')
      // pdfjs acepta OffscreenCanvas en runtime pero su tipo solo declara HTMLCanvasElement.
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise
      const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 })
      results.push({ name: `${base}-p${pageNumber}.${target}`, mime, buffer: await blob.arrayBuffer(), sizeBytes: blob.size, previewKind: 'image' })
      onProgress({ percent: Math.round((pageNumber / pdf.numPages) * 100), stage: `Página ${pageNumber} de ${pdf.numPages}` })
    }
    return results
  }
}
