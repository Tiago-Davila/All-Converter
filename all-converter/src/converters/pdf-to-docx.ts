import { runPdf } from './pdf'
import type { Converter } from './types'
import { PDF_SOURCE } from './sources'
export const pdfToDocxConverter: Converter = { id: 'pdf-to-docx', label: 'PDF a DOCX', from: [PDF_SOURCE], to: 'docx', maxSizeMB: 25, convert(file, progress, options, signal) { return runPdf(file, 'pdf-to-docx', options, progress, signal) } }
