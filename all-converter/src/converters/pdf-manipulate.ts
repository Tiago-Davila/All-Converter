import { runPdf } from './pdf'
import type { Converter } from './types'
export const pdfMergeConverter: Converter = { id: 'pdf-merge', label: 'Unir PDFs', from: ['pdf'], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-merge', options, progress, signal) } }
export const pdfSplitConverter: Converter = { id: 'pdf-split', label: 'Dividir PDF', from: ['pdf'], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-split', options, progress, signal) } }
export const pdfRotateConverter: Converter = { id: 'pdf-rotate', label: 'Rotar PDF', from: ['pdf'], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-rotate', options, progress, signal) } }
