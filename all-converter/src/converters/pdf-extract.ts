import { runPdf } from './pdf'
import type { Converter } from './types'
export const pdfTextConverter: Converter = { id: 'pdf-to-txt', label: 'PDF a TXT', from: ['pdf'], to: 'txt', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-to-txt', options, progress, signal) } }
export const pdfToImagesConverter: Converter = { id: 'pdf-to-images', label: 'PDF a imágenes', from: ['pdf'], to: 'png|jpg', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-to-images', options, progress, signal) } }
