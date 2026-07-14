import { runOffice } from './office'
import type { Converter } from './types'
import { DOCX_SOURCE } from './sources'
export const docxTextConverter: Converter = { id: 'docx-to-text', label: 'DOCX a texto o HTML', from: [DOCX_SOURCE], to: 'txt|html', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'docx-text', options, progress, signal) } }
