import { describe, expect, it } from 'vitest'
import type { WorkerStartRequest } from '../../src/workers/types'
import { validateImageRequest, validateMediaRequest, validateOfficeRequest, validatePdfRequest, validateZipRequest } from '../../src/workers/validation'

function request(operation: string, name: string, mime: string, options: WorkerStartRequest['options'] = {}): WorkerStartRequest {
  return { kind: 'start', jobId: 'job', operation, inputs: [{ name, mime, buffer: new ArrayBuffer(1) }], options }
}

describe('validación defensiva de workers', () => {
  it('rechaza formatos y opciones inválidos de imagen', () => {
    expect(() => validateImageRequest(request('image-convert', 'a.gif', 'image/gif', { mime: 'image/png' }))).toThrow('formato no compatible')
    expect(() => validateImageRequest(request('image-convert', 'a.png', 'image/png', { mime: 'image/gif' }))).toThrow('mime inválida')
    expect(() => validateImageRequest(request('image-convert', 'a.png', 'image/png', { mime: 'image/png', quality: 2 }))).toThrow('calidad')
  })

  it('rechaza pares Office fuera de la matriz', () => {
    expect(() => validateOfficeRequest(request('spreadsheet-convert', 'a.csv', 'text/csv', { target: 'json' }))).toThrow('no es compatible')
    expect(() => validateOfficeRequest(request('docx-text', 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { target: 'pdf' }))).toThrow('target inválida')
  })

  it('exige entradas PDF válidas y cantidad correcta', () => {
    expect(() => validatePdfRequest(request('pdf-to-txt', 'a.txt', 'text/plain'))).toThrow('formato no compatible')
    expect(() => validatePdfRequest(request('pdf-merge', 'a.pdf', 'application/pdf'))).toThrow('al menos dos')
  })

  it('rechaza operaciones multimedia desconocidas e identidad', () => {
    expect(() => validateMediaRequest(request('video-mágico', 'a.mp4', 'video/mp4', { outputName: 'a.mp3' }))).toThrow('desconocida')
    expect(() => validateMediaRequest(request('audio', 'a.mp3', 'audio/mpeg', { outputName: 'a.mp3' }))).toThrow('no es compatible')
  })

  it('rechaza ZIP vacío u operaciones desconocidas', () => {
    expect(() => validateZipRequest({ kind: 'start', jobId: 'job', operation: 'zip-create', inputs: [], options: {} })).toThrow('No hay archivos')
    expect(() => validateZipRequest(request('zip-remoto', 'a.txt', 'text/plain'))).toThrow('desconocida')
  })
})
