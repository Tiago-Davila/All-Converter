import { startWorker } from '../workers/client'
import type { WorkerStartRequest } from '../workers/types'
export { resolveZipPaths } from './zip-paths'

export interface ZipEntry { name: string; buffer: ArrayBuffer; relativePath?: string }

export async function createZip(entries: readonly ZipEntry[], signal = new AbortController().signal): Promise<ArrayBuffer> {
  const inputs = entries.map((entry) => ({ name: entry.name, buffer: entry.buffer, relativePath: entry.relativePath }))
  if (import.meta.env.MODE === 'test') {
    const { executeZip } = await import('../workers/zip-operations')
    return executeZip(inputs)
  }
  const request: WorkerStartRequest = { kind: 'start', jobId: crypto.randomUUID(), operation: 'zip-create', inputs, options: {} }
  const results = await startWorker(new Worker(new URL('../workers/zip.worker.ts', import.meta.url), { type: 'module' }), request, signal)
  const result = results[0]
  if (!result) throw new Error('El worker ZIP no devolvió un archivo.')
  return result.buffer
}
