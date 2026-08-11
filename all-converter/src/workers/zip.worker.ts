import { streamZip } from './zip-operations'
import type { WorkerResponse, ZipWorkerRequest } from './types'
import { validateZipRequest } from './validation'

const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })

self.onmessage = async ({ data }: MessageEvent<ZipWorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }
  try {
    validateZipRequest(data)
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 0, stage: 'Preparando ZIP' } })

    // El progreso se estima por bytes escritos sobre el total declarado por los blobs.
    const total = data.inputs.reduce((sum, input) => sum + input.blob.size, 0)
    let written = 0

    for await (const chunk of streamZip(data.inputs)) {
      written += chunk.length
      // El buffer del trozo se transfiere: no se copia (Principio IV).
      send({ kind: 'chunk', jobId: data.jobId, chunk }, [chunk.buffer])
      if (total > 0) {
        send({ kind: 'progress', jobId: data.jobId, progress: { percent: Math.min(99, Math.round((written / total) * 100)), stage: 'Empaquetando' } })
      }
    }

    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 100, stage: 'ZIP creado' } })
    // Sin resultados: el contenido ya viajó como trozos. Este mensaje sólo cierra el trabajo.
    send({ kind: 'result', jobId: data.jobId, results: [] })
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'No se pudo crear el ZIP.' })
  }
}
