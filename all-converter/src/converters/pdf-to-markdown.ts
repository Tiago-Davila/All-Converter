import { runPdf } from './pdf'
import type { Converter } from './types'
import { PDF_SOURCE } from './sources'
// pdf-to-md es una operación de LECTURA: no se agrega a writeOperations en pdf.ts, para que
// siga cayendo en pdf-read.worker.ts y no arrastre pdf-lib ni docx a ese chunk.
export const pdfToMarkdownConverter: Converter = { id: 'pdf-to-md', label: 'PDF a Markdown', from: [PDF_SOURCE], to: 'md', maxSizeMB: 25, limitation: 'La estructura se deduce del diseño del PDF: los títulos por el tamaño de la fuente y las tablas por la alineación de las columnas, así que puede haber diferencias con el original. No se extraen las imágenes. Un PDF escaneado, sin capa de texto, se rechaza porque haría falta OCR.', convert(file, progress, options, signal) { return runPdf(file, 'pdf-to-md', options, progress, signal) } }
