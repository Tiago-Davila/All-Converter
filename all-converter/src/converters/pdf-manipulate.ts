import { runPdf, runPdfFiles } from './pdf'
import { PDF_SOURCE } from './sources'
import type { Converter } from './types'
export const pdfMergeConverter: Converter = {
  id: 'pdf-merge', label: 'Unir PDFs', from: [PDF_SOURCE], to: 'pdf', maxSizeMB: 25,
  convert(file, progress, options, signal) { return runPdf(file, 'pdf-merge', options, progress, signal) },
  convertMany(files, progress, options, signal) { return runPdfFiles(files, 'pdf-merge', options, progress, signal) },
}
export const pdfSplitConverter: Converter = { id: 'pdf-split', label: 'Dividir PDF', from: [PDF_SOURCE], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-split', options, progress, signal) } }
export const pdfRotateConverter: Converter = { id: 'pdf-rotate', label: 'Rotar PDF', from: [PDF_SOURCE], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-rotate', options, progress, signal) } }
