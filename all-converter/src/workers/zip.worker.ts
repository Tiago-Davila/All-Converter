import type { ConversionResult } from '../converters/types'
import { executeZip } from './zip-operations'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'

const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })
self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }
  try {
    if (data.operation !== 'zip-create') throw new Error(`Operación ZIP desconocida: ${data.operation}.`)
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 10, stage: 'Preparando ZIP' } })
    const buffer = await executeZip(data.inputs)
    const results: ConversionResult[] = [{ name: 'convertitodo.zip', mime: 'application/zip', buffer, sizeBytes: buffer.byteLength }]
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 100, stage: 'ZIP creado' } })
    send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results))
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'No se pudo crear el ZIP.' })
  }
}
