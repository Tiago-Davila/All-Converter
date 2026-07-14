import { runOffice } from './office'
import type { Converter } from './types'
import { DOCX_SOURCE } from './sources'
export const docxToPdfConverter: Converter = { id: 'docx-to-pdf', label: 'DOCX a PDF', from: [DOCX_SOURCE], to: 'pdf', maxSizeMB: 25, limitation: 'La conversión DOCX→PDF tiene fidelidad parcial: se conservan texto y estructura, pero no el diseño, las imágenes ni las fuentes originales.', convert(file, progress, options, signal) { return runOffice(file, 'docx-to-pdf', options, progress, signal) } }
