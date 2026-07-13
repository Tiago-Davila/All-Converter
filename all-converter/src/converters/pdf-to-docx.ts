import { runPdf } from './pdf'
import type { Converter } from './types'
export const pdfToDocxConverter: Converter = { id: 'pdf-to-docx', label: 'PDF a DOCX', from: ['pdf'], to: 'docx', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-to-docx', options, progress, signal) } }
