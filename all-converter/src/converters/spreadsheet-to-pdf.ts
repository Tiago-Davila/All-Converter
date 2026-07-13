import { runOffice } from './office'
import type { Converter } from './types'
export const spreadsheetToPdfConverter: Converter = { id: 'spreadsheet-to-pdf', label: 'Planilla a PDF', from: ['spreadsheet'], to: 'pdf', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'spreadsheet-to-pdf', options, progress, signal) } }
