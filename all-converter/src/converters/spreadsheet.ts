import { runOffice } from './office'
import type { Converter } from './types'
export const spreadsheetConverter: Converter = { id: 'spreadsheet-convert', label: 'Convertir planilla', from: ['spreadsheet'], to: 'csv|json|xlsx', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'spreadsheet-convert', options, progress, signal) } }
