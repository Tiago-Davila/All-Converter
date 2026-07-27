/**
 * image-resize (003): cambia la resolución de una imagen sin pasar por la matriz
 * de conversión. Implementa Converter para reusar startWorker y el canal tipado,
 * pero DELIBERADAMENTE **no se registra** en registry.ts: registrarlo lo haría
 * aparecer como destino dentro de la cola del convertidor, que es justo lo que
 * FR-015 separa en una página aparte. Discrepancia con la Regla 3 de Claude.md,
 * documentada en specs/003-redimensionar-imagen/spec.md.
 *
 * Diferencias con imageConverter (001): acepta cualquier entrada que el navegador
 * decodifique (FR-002) y usa dimensiones exactas, así que puede agrandar (FR-008).
 */
import { startWorker } from '../workers/client'
import type { WorkerOptions, WorkerStartRequest } from '../workers/types'
import type { Converter } from './types'
import { IMAGE_SOURCE } from './sources'

export const imageResizeConverter: Converter = {
  id: 'image-resize', label: 'Redimensionar imagen', from: [IMAGE_SOURCE], to: 'png|jpg|webp', maxSizeMB: 50,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    let buffer: ArrayBuffer
    try { buffer = await file.arrayBuffer() } catch { throw new Error('No se pudo leer la imagen. Verificá que siga disponible.') }

    const workerOptions: WorkerOptions = {
      mime: typeof options.mime === 'string' ? options.mime : 'image/png',
      quality: typeof options.quality === 'number' ? options.quality : 0.9,
      width: typeof options.width === 'number' ? options.width : undefined,
      height: typeof options.height === 'number' ? options.height : undefined,
    }
    const request: WorkerStartRequest = {
      kind: 'start', jobId: crypto.randomUUID(), operation: 'image-resize',
      inputs: [{ name: file.name, mime: file.type || undefined, buffer }], options: workerOptions,
    }
    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' })
    return startWorker(worker, request, signal, onProgress)
  },
}
