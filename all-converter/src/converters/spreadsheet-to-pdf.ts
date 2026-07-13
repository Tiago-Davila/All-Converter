import { runOffice } from './office'
import type { Converter } from './types'
import { SPREADSHEET_PDF_SOURCE } from './sources'
export const spreadsheetToPdfConverter: Converter = { id: 'spreadsheet-to-pdf', label: 'Planilla a PDF', from: [SPREADSHEET_PDF_SOURCE], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'spreadsheet-to-pdf', options, progress, signal) } }
