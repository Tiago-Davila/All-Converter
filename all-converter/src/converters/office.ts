import { startWorker } from '../workers/client'
import type { WorkerOptions, WorkerStartRequest } from '../workers/types'
import type { ConversionProgress, ConversionResult } from './types'

function sanitizeOptions(options: Record<string, unknown>): WorkerOptions {
  return Object.fromEntries(Object.entries(options).filter((entry): entry is [string, string | number | boolean | null | undefined] => {
    const value = entry[1]
    return value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)
  }))
}

export async function runOffice(
  file: File,
  operation: string,
  options: Record<string, unknown>,
  onProgress: (progress: ConversionProgress) => void,
  signal: AbortSignal,
): Promise<ConversionResult[]> {
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
  const buffer = await file.arrayBuffer().catch(() => { throw new Error('No se pudo leer el archivo de Office.') })
  const input = { name: file.name, mime: file.type || undefined, buffer }
  const workerOptions = sanitizeOptions(options)

  if (import.meta.env.MODE === 'test') {
    const { executeOfficeOperation } = await import('../workers/office-operations')
    return executeOfficeOperation(operation, input, workerOptions, onProgress)
  }

  const request: WorkerStartRequest = { kind: 'start', jobId: crypto.randomUUID(), operation, inputs: [input], options: workerOptions }
  return startWorker(new Worker(new URL('../workers/office.worker.ts', import.meta.url), { type: 'module' }), request, signal, onProgress)
}
