import type { ConversionProgress, ConversionResult } from '../converters/types'
import type { StartRequest, WorkerRequest, WorkerResponse } from './types'
import { requestTransferables } from './worker-utils'

export function startWorker(
  worker: Worker,
  request: StartRequest,
  signal: AbortSignal,
  onProgress?: (progress: ConversionProgress) => void,
  /** Sólo lo usa el empaquetado ZIP: recibe los trozos a medida que se escriben. */
  onChunk?: (chunk: Uint8Array) => void,
): Promise<ConversionResult[]> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const abort = () => {
      try { worker.postMessage({ kind: 'cancel', jobId: request.jobId } satisfies WorkerRequest) } catch { /* El worker puede haber terminado durante el aborto. */ }
      finish(() => reject(new DOMException('Cancelado', 'AbortError')))
    }

    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.jobId !== request.jobId || settled) return
      if (data.kind === 'progress') { onProgress?.(data.progress); return }
      // Un trozo NO cierra el trabajo: siguen llegando hasta el `result` final.
      if (data.kind === 'chunk') { onChunk?.(data.chunk); return }
      if (data.kind === 'error') { finish(() => reject(new Error(data.message))); return }
      finish(() => resolve(data.results))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish(() => reject(new Error(event.message || 'El worker falló durante la conversión.')))
    }
    worker.onmessageerror = () => finish(() => reject(new Error('El worker devolvió un mensaje que no se pudo leer.')))

    try {
      worker.postMessage(request, requestTransferables(request))
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('No se pudo iniciar el worker.')))
    }
  })
}
