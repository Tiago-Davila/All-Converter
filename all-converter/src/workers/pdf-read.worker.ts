import { executePdfOperation } from './pdf-operations'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'
import { validatePdfRequest } from './validation'
const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })
self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => { if (data.kind === 'cancel') { self.close(); return } try { validatePdfRequest(data); const results = await executePdfOperation(data.operation, data.inputs, data.options, (progress) => send({ kind: 'progress', jobId: data.jobId, progress })); send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results)) } catch (error) { send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Falló la lectura del PDF.' }) } }
