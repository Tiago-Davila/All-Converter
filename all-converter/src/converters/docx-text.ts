import { runOffice } from './office'
import type { Converter } from './types'
export const docxTextConverter: Converter = { id: 'docx-to-text', label: 'DOCX a texto o HTML', from: ['document'], to: 'txt|html', maxSizeMB: 25, convert(file, progress, options, signal) { return runOffice(file, 'docx-text', options, progress, signal) } }
