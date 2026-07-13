import { runPdf } from './pdf'
import type { Converter } from './types'
export const imagesToPdfConverter: Converter = { id: 'images-to-pdf', label: 'Imágenes a PDF', from: ['image'], to: 'pdf', maxSizeMB: 50, convert(file, progress, options, signal) { return runPdf(file, 'images-to-pdf', options, progress, signal) } }
