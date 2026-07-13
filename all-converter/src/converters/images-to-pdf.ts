import { runPdf, runPdfFiles } from './pdf'
import { IMAGE_SOURCE } from './sources'
import type { Converter } from './types'
export const imagesToPdfConverter: Converter = {
  id: 'images-to-pdf', label: 'Imágenes a PDF', from: [IMAGE_SOURCE], to: 'pdf', maxSizeMB: 50,
  convert(file, progress, options, signal) { return runPdf(file, 'images-to-pdf', options, progress, signal) },
  convertMany(files, progress, options, signal) { return runPdfFiles(files, 'images-to-pdf', options, progress, signal) },
}
