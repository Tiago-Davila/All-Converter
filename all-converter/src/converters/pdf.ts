import { startWorker } from '../workers/client'
import type { WorkerInput, WorkerOptions, WorkerStartRequest } from '../workers/types'
import type { ConversionProgress, ConversionResult } from './types'

const writeOperations = new Set(['pdf-merge', 'pdf-split', 'pdf-rotate', 'images-to-pdf'])

function sanitizeOptions(options: Record<string, unknown>): WorkerOptions {
  const entries = Object.entries(options).filter((entry): entry is [string, string | number | boolean | null | readonly (string | number | boolean | null)[]] => {
    const value = entry[1]
    return value === null || ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value) && value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
  })
  return Object.fromEntries(entries)
}

async function fileInput(file: File): Promise<WorkerInput> {
  return { name: file.name, mime: file.type || undefined, buffer: await file.arrayBuffer() }
}

export async function runPdf(file: File, operation: string, options: Record<string, unknown>, onProgress: (progress: ConversionProgress) => void, signal: AbortSignal): Promise<ConversionResult[]> {
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
  const inputs = [await fileInput(file)]
  if (Array.isArray(options.mergeWith)) {
    for (const extra of options.mergeWith) if (extra instanceof File) inputs.push(await fileInput(extra))
  }
  const workerOptions = sanitizeOptions(options)
  if (import.meta.env.MODE === 'test') {
    const { executePdfOperation } = await import('../workers/pdf-operations')
    return executePdfOperation(operation, inputs, workerOptions, onProgress)
  }
  const request: WorkerStartRequest = { kind: 'start', jobId: crypto.randomUUID(), operation, inputs, options: workerOptions }
  const worker = writeOperations.has(operation)
    ? new Worker(new URL('../workers/pdf-write.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('../workers/pdf-read.worker.ts', import.meta.url), { type: 'module' })
  return startWorker(worker, request, signal, onProgress)
}
