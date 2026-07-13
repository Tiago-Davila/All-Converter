import { executeOfficeOperation } from './office-operations'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'

const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })
self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }
  try {
    const input = data.inputs[0]
    if (!input) throw new Error('Falta el archivo de Office de entrada.')
    const results = await executeOfficeOperation(data.operation, input, data.options, (value) => send({ kind: 'progress', jobId: data.jobId, progress: value }))
    send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results))
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Falló la conversión de Office.' })
  }
}
