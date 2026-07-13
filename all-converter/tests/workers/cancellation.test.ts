import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { startWorker } from '../../src/workers/client'
import type { WorkerRequest, WorkerStartRequest } from '../../src/workers/types'

class HangingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  readonly messages: WorkerRequest[] = []
  terminate = vi.fn()
  postMessage(message: WorkerRequest) { this.messages.push(message) }
}

describe('cancelación de conversiones pesadas', () => {
  it('termina un worker bloqueado y rechaza en menos de un segundo', async () => {
    const worker = new HangingWorker()
    const controller = new AbortController()
    const request: WorkerStartRequest = { kind: 'start', jobId: 'heavy', operation: 'heavy', inputs: [{ name: 'large.bin', buffer: new ArrayBuffer(1) }], options: {} }
    const started = performance.now()
    const promise = startWorker(worker as unknown as Worker, request, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(worker.messages.at(-1)).toEqual({ kind: 'cancel', jobId: 'heavy' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('todos los dominios pesados delegan al cliente worker común en producción', async () => {
    for (const sourcePath of ['image.ts', 'office.ts', 'pdf.ts', 'media.ts']) {
      const source = await readFile(new URL(`../../src/converters/${sourcePath}`, import.meta.url), 'utf8')
      expect(source, sourcePath).toContain('startWorker')
    }
    const zip = await readFile(new URL('../../src/lib/zip.ts', import.meta.url), 'utf8')
    expect(zip).toContain('startWorker')
  })
})
