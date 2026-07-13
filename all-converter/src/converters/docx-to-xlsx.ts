import { runOffice } from './office'
import type { Converter } from './types'
export const docxToXlsxConverter: Converter = { id: 'docx-to-xlsx', label: 'DOCX a XLSX', from: ['document'], to: 'xlsx', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'docx-to-xlsx', options, progress, signal) } }
