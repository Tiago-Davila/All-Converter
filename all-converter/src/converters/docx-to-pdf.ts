import { runOffice } from './office'
import type { Converter } from './types'
import { DOCX_SOURCE } from './sources'
export const docxToPdfConverter: Converter = { id: 'docx-to-pdf', label: 'DOCX a PDF', from: [DOCX_SOURCE], to: 'pdf', maxSizeMB: 25, limitation: 'La conversión DOCX→PDF tiene fidelidad parcial: se conservan texto, encabezados, listas, tablas, negrita/itálica e imágenes con su tamaño original, pero no las fuentes ni los márgenes exactos. Las imágenes se ubican en el flujo del texto (no en su posición flotante), se ignoran los recortes y no se incluyen las que están dentro de tablas, encabezados o pies de página.', convert(file, progress, options, signal) { return runOffice(file, 'docx-to-pdf', options, progress, signal) } }
