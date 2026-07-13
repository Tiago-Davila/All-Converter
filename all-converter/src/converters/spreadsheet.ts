import { runOffice } from './office'
import type { Converter } from './types'
import { SPREADSHEET_SOURCE } from './sources'
export const spreadsheetConverter: Converter = { id: 'spreadsheet-convert', label: 'Convertir planilla', from: [SPREADSHEET_SOURCE], to: 'csv|json|xlsx', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'spreadsheet-convert', options, progress, signal) } }
