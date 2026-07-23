import { runOffice } from './office'
import type { Converter } from './types'
import { DOCX_SOURCE } from './sources'
export const docxToPdfConverter: Converter = { id: 'docx-to-pdf', label: 'DOCX a PDF', from: [DOCX_SOURCE], to: 'pdf', maxSizeMB: 25, limitation: 'La conversión DOCX→PDF tiene fidelidad parcial: se conservan texto, encabezados, listas, tablas, negrita/itálica e imágenes, pero no las fuentes, los márgenes ni el posicionamiento exactos del original.', convert(file, progress, options, signal) { return runOffice(file, 'docx-to-pdf', options, progress, signal) } }
