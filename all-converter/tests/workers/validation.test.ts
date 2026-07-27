import { describe, expect, it } from 'vitest'
import type { WorkerStartRequest } from '../../src/workers/types'
import { validateImageRequest, validateImageResizeRequest, validateMediaRequest, validateOfficeRequest, validatePdfRequest, validateZipRequest } from '../../src/workers/validation'

function request(operation: string, name: string, mime: string, options: WorkerStartRequest['options'] = {}): WorkerStartRequest {
  return { kind: 'start', jobId: 'job', operation, inputs: [{ name, mime, buffer: new ArrayBuffer(1) }], options }
}

describe('validación defensiva de workers', () => {
  it('rechaza formatos y opciones inválidos de imagen', () => {
    expect(() => validateImageRequest(request('image-convert', 'a.gif', 'image/gif', { mime: 'image/png' }))).toThrow('formato no compatible')
    expect(() => validateImageRequest(request('image-convert', 'a.png', 'image/png', { mime: 'image/gif' }))).toThrow('mime inválida')
    expect(() => validateImageRequest(request('image-convert', 'a.png', 'image/png', { mime: 'image/png', quality: 2 }))).toThrow('calidad')
  })

  it('acepta entradas exóticas al redimensionar pero acota la salida (003 FR-002/FR-009)', () => {
    const size = { mime: 'image/png', width: 800, height: 600 }
    expect(() => validateImageResizeRequest(request('image-resize', 'a.gif', 'image/gif', size))).not.toThrow()
    expect(() => validateImageResizeRequest(request('image-resize', 'a.avif', 'image/avif', size))).not.toThrow()
    expect(() => validateImageResizeRequest(request('image-resize', 'a.png', 'image/png', { ...size, mime: 'image/gif' }))).toThrow('mime inválida')
  })

  it('rechaza dimensiones fuera del invariante (003 FR-007)', () => {
    const at = (width: number, height: number) => () => validateImageResizeRequest(request('image-resize', 'a.png', 'image/png', { mime: 'image/png', width, height }))
    expect(at(1920, 1080)).not.toThrow()
    expect(at(1080, 1920)).not.toThrow()
    expect(at(1921, 1080)).toThrow('fuera del rango')
    expect(at(1200, 1200)).toThrow('fuera del rango')
    expect(at(31, 100)).toThrow('fuera del rango')
    expect(at(100.5, 100)).toThrow('fuera del rango')
    expect(() => validateImageResizeRequest(request('image-resize', 'a.png', 'image/png', { mime: 'image/png' }))).toThrow('fuera del rango')
    expect(() => validateImageResizeRequest(request('image-agrandar', 'a.png', 'image/png', { mime: 'image/png', width: 800, height: 600 }))).toThrow('desconocida')
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
