import { startWorker } from '../workers/client'
import type { WorkerOptions, WorkerStartRequest } from '../workers/types'
import type { Converter } from './types'
import { IMAGE_SOURCE } from './sources'

export const imageConverter: Converter = {
  id: 'image-convert', label: 'Convertir imagen', from: [IMAGE_SOURCE], to: 'png|jpg|webp', maxSizeMB: 50,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    let buffer: ArrayBuffer
    try { buffer = await file.arrayBuffer() } catch { throw new Error('No se pudo leer la imagen. Verificá que siga disponible.') }

    const workerOptions: WorkerOptions = {
      mime: typeof options.mime === 'string' ? options.mime : 'image/png',
      quality: typeof options.quality === 'number' ? options.quality : 0.85,
      maxWidth: typeof options.maxWidth === 'number' ? options.maxWidth : undefined,
      maxHeight: typeof options.maxHeight === 'number' ? options.maxHeight : undefined,
    }
    const request: WorkerStartRequest = {
      kind: 'start', jobId: crypto.randomUUID(), operation: 'image-convert',
      inputs: [{ name: file.name, mime: file.type || undefined, buffer }], options: workerOptions,
    }
    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' })
    return startWorker(worker, request, signal, onProgress)
  },
}
