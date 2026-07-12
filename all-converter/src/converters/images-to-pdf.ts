import { PDFDocument } from 'pdf-lib'
import type { Converter } from './types'

export const imagesToPdfConverter: Converter = { id: 'images-to-pdf', label: 'Imágenes a PDF', from: ['image'], to: 'pdf', maxSizeMB: 50,
  async convert(file, onProgress, _options, signal) { if (signal.aborted) throw new DOMException('Cancelado', 'AbortError'); const pdf = await PDFDocument.create(); const bytes = await file.arrayBuffer(); const image = file.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); const page = pdf.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height }); onProgress({ percent: 100, stage: 'PDF creado' }); const output = new Uint8Array(await pdf.save()); return [{ name: file.name.replace(/\.[^.]+$/, '.pdf'), mime: 'application/pdf', buffer: output.buffer, sizeBytes: output.byteLength, previewKind: 'pdf' }] }
}
