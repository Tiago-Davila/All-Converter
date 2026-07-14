import { runOffice } from './office'
import type { Converter } from './types'
import { DOCX_SOURCE } from './sources'
export const docxToXlsxConverter: Converter = { id: 'docx-to-xlsx', label: 'DOCX a XLSX', from: [DOCX_SOURCE], to: 'xlsx', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'docx-to-xlsx', options, progress, signal) } }
