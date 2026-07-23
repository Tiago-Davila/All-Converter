import { runOffice } from './office'
import type { Converter } from './types'
import { ODT_SOURCE } from './sources'
export const odtToPdfConverter: Converter = { id: 'odt-to-pdf', label: 'ODT a PDF', from: [ODT_SOURCE], to: 'pdf', maxSizeMB: 25, limitation: 'La conversión ODT→PDF tiene fidelidad parcial: se conservan texto, encabezados, listas, tablas e imágenes, pero no las fuentes, los márgenes ni el posicionamiento exactos del original.', convert(file, progress, options, signal) { return runOffice(file, 'odt-to-pdf', options, progress, signal) } }
