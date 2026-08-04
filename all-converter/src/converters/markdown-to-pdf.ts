import { runOffice } from './office'
import type { Converter } from './types'
import { MARKDOWN_SOURCE } from './sources'
export const markdownToPdfConverter: Converter = { id: 'md-to-pdf', label: 'Markdown a PDF', from: [MARKDOWN_SOURCE], to: 'pdf', maxSizeMB: 25, limitation: 'Se convierten encabezados, párrafos, listas, tablas, citas, bloques de código y énfasis. Las imágenes solo se incrustan si están escritas como data URI: una imagen por ruta o por URL se omite, porque buscarla implicaría salir del dispositivo. No se interpretan el HTML embebido, las notas al pie ni las listas de tareas.', convert(file, progress, options, signal) { return runOffice(file, 'md-to-pdf', options, progress, signal) } }
