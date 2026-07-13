import type { WorkerRequest, WorkerResponse } from './types'
import { requestTransferables } from './worker-utils'

export function startWorker(worker: Worker, request: Extract<WorkerRequest, { kind: 'start' }>, signal: AbortSignal): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const stop = () => { worker.postMessage({ kind: 'cancel', jobId: request.jobId } satisfies WorkerRequest); worker.terminate(); reject(new DOMException('Cancelado', 'AbortError')) }
    signal.addEventListener('abort', stop, { once: true })
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => { if (data.jobId === request.jobId && data.kind !== 'progress') { signal.removeEventListener('abort', stop); worker.terminate(); resolve(data) } }
    worker.onerror = () => reject(new Error('Error del worker'))
    worker.postMessage(request, requestTransferables(request))
  })
}
