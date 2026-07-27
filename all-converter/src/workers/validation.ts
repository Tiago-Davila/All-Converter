import { isValidPair } from '../lib/image-resize'
import type { WorkerInput, WorkerStartRequest } from './types'

const ext = (input: WorkerInput) => input.name.split('.').pop()?.toLowerCase() ?? ''
function inputs(request: WorkerStartRequest, minimum = 1, maximum = minimum) { if (request.inputs.length < minimum || request.inputs.length > maximum) throw new Error(`${request.operation} requiere ${minimum === maximum ? minimum : `${minimum}-${maximum}`} archivo(s).`) }
function format(input: WorkerInput, mimes: readonly string[], extensions: readonly string[], label: string) { if (!mimes.includes(input.mime ?? '') && !extensions.includes(ext(input))) throw new Error(`${label}: formato no compatible (${input.mime || ext(input) || 'desconocido'}).`) }
function choice(request: WorkerStartRequest, key: string, allowed: readonly string[]) { const value = request.options[key]; if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`Opción ${key} inválida para ${request.operation}.`); return value }

export function validateImageRequest(request: WorkerStartRequest) {
  if (request.operation !== 'image-convert') throw new Error(`Operación de imagen desconocida: ${request.operation}.`)
  inputs(request); format(request.inputs[0], ['image/png', 'image/jpeg', 'image/webp'], ['png', 'jpg', 'jpeg', 'webp'], 'Imagen'); choice(request, 'mime', ['image/png', 'image/jpeg', 'image/webp'])
  for (const key of ['maxWidth', 'maxHeight'] as const) { const value = request.options[key]; if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error(`Opción ${key} inválida.`) }
  const quality = request.options.quality; if (quality !== undefined && (typeof quality !== 'number' || quality <= 0 || quality > 1)) throw new Error('La calidad debe estar entre 0 y 1.')
}

/**
 * Redimensionado (003). A diferencia de validateImageRequest, NO hay whitelist de
 * mime de ENTRADA: la frontera es lo que el navegador sepa decodificar (FR-002).
 * La salida sí se restringe a lo que el canvas sabe codificar.
 */
export function validateImageResizeRequest(request: WorkerStartRequest) {
  if (request.operation !== 'image-resize') throw new Error(`Operación de imagen desconocida: ${request.operation}.`)
  inputs(request); choice(request, 'mime', ['image/png', 'image/jpeg', 'image/webp'])
  const { width, height } = request.options
  if (typeof width !== 'number' || typeof height !== 'number' || !isValidPair(width, height)) throw new Error('Las dimensiones pedidas están fuera del rango permitido.')
  const quality = request.options.quality; if (quality !== undefined && (typeof quality !== 'number' || quality <= 0 || quality > 1)) throw new Error('La calidad debe estar entre 0 y 1.')
}

export function validateOfficeRequest(request: WorkerStartRequest) {
  inputs(request); const docx = () => format(request.inputs[0], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['docx'], 'DOCX')
  if (request.operation === 'docx-text') { docx(); choice(request, 'target', ['txt', 'html']); return }
  if (request.operation === 'docx-to-pdf' || request.operation === 'docx-to-xlsx') { docx(); return }
  if (request.operation === 'odt-to-pdf') { format(request.inputs[0], ['application/vnd.oasis.opendocument.text'], ['odt'], 'ODT'); return }
  if (request.operation === 'spreadsheet-to-pdf') { format(request.inputs[0], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'], ['xlsx', 'ods', 'csv'], 'Planilla'); return }
  if (request.operation === 'spreadsheet-convert') { format(request.inputs[0], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv', 'application/json'], ['xlsx', 'ods', 'csv', 'json'], 'Planilla'); const target = choice(request, 'target', ['csv', 'json', 'xlsx']); const source = ext(request.inputs[0]); const workbooks = ['xlsx', 'ods']; if (source === target || (!workbooks.includes(source) && !workbooks.includes(target))) throw new Error(`La conversión ${source.toUpperCase()}→${target.toUpperCase()} no es compatible.`); return }
  throw new Error(`Operación Office desconocida: ${request.operation}.`)
}

export function validatePdfRequest(request: WorkerStartRequest) {
  const pdf = (input: WorkerInput) => format(input, ['application/pdf'], ['pdf'], 'PDF')
  if (request.operation === 'images-to-pdf') { if (!request.inputs.length) throw new Error('Se requiere al menos una imagen.'); request.inputs.forEach((input) => format(input, ['image/png', 'image/jpeg', 'image/webp'], ['png', 'jpg', 'jpeg', 'webp'], 'Imagen')); return }
  if (request.operation === 'pdf-merge') { if (request.inputs.length < 2) throw new Error('Para unir PDFs se necesitan al menos dos archivos.'); request.inputs.forEach(pdf); return }
  inputs(request); pdf(request.inputs[0])
  if (request.operation === 'pdf-to-images') { choice(request, 'target', ['png', 'jpg']); return }
  if (['pdf-to-txt', 'pdf-to-docx', 'pdf-split', 'pdf-rotate'].includes(request.operation)) return
  throw new Error(`Operación PDF desconocida: ${request.operation}.`)
}

export function validateMediaRequest(request: WorkerStartRequest) {
  const output = request.options.outputName
  if (request.operation === 'extract-mp3') { inputs(request); format(request.inputs[0], ['video/mp4'], ['mp4'], 'Video'); if (typeof output !== 'string' || !output.endsWith('.mp3')) throw new Error('La salida MP4→MP3 debe terminar en .mp3.'); return }
  if (request.operation === 'mp3-mp4') { inputs(request, 1, 2); format(request.inputs[0], ['audio/mpeg'], ['mp3'], 'Audio'); if (typeof output !== 'string' || !output.endsWith('.mp4')) throw new Error('La salida MP3→MP4 debe terminar en .mp4.'); if (request.inputs[1]) format(request.inputs[1], ['image/png', 'image/jpeg', 'image/webp'], ['png', 'jpg', 'jpeg', 'webp'], 'Portada'); if (!request.inputs[1] && request.options.generateWaveform !== true) throw new Error('Se requiere portada o waveform.'); return }
  if (request.operation === 'audio') { inputs(request); format(request.inputs[0], ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'], ['mp3', 'wav', 'ogg', 'm4a'], 'Audio'); if (typeof output !== 'string') throw new Error('Falta el nombre de salida.'); const source = ext(request.inputs[0]); const target = output.split('.').pop()?.toLowerCase() ?? ''; const allowed = source === 'mp3' ? ['wav', 'ogg', 'm4a'] : ['mp3']; if (!allowed.includes(target)) throw new Error(`La conversión ${source.toUpperCase()}→${target.toUpperCase()} no es compatible.`); return }
  throw new Error(`Operación multimedia desconocida: ${request.operation}.`)
}

export function validateZipRequest(request: WorkerStartRequest) { if (request.operation !== 'zip-create') throw new Error(`Operación ZIP desconocida: ${request.operation}.`); if (!request.inputs.length) throw new Error('No hay archivos para incluir en el ZIP.'); if (request.inputs.some((input) => !input.name.trim())) throw new Error('Todos los archivos del ZIP necesitan un nombre.') }
