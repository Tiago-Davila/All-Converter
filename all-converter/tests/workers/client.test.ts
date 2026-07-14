import { describe, expect, it, vi } from 'vitest'
import { runMedia } from '../../src/converters/media'
import { startWorker } from '../../src/workers/client'
import type { WorkerRequest, WorkerStartRequest } from '../../src/workers/types'

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  readonly posted: Array<{ message: WorkerRequest; transfer: Transferable[] }> = []
  terminate = vi.fn()

  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer })
  }
}

function request(buffer = new ArrayBuffer(4)): WorkerStartRequest {
  return { kind: 'start', jobId: 'job-1', operation: 'test', inputs: [{ name: 'input.bin', buffer }], options: {} }
}

describe('cliente worker', () => {
  it('propaga progreso, resuelve una sola vez y limpia el worker', async () => {
    const worker = new FakeWorker()
    const progress = vi.fn()
    const promise = startWorker(worker as unknown as Worker, request(), new AbortController().signal, progress)
    worker.onmessage?.({ data: { kind: 'progress', jobId: 'job-1', progress: { percent: 25, stage: 'Leyendo' } } } as MessageEvent)
    worker.onmessage?.({ data: { kind: 'result', jobId: 'job-1', results: [] } } as MessageEvent)
    expect(await promise).toEqual([])
    expect(progress).toHaveBeenCalledWith({ percent: 25, stage: 'Leyendo' })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.posted[0].transfer).toHaveLength(1)
    expect(worker.onmessage).toBeNull()
    expect(worker.onerror).toBeNull()
    expect(worker.onmessageerror).toBeNull()
  })

  it('rechaza mensajes error y errores de ejecución', async () => {
    const responseWorker = new FakeWorker()
    const responsePromise = startWorker(responseWorker as unknown as Worker, request(), new AbortController().signal)
    responseWorker.onmessage?.({ data: { kind: 'error', jobId: 'job-1', message: 'archivo inválido' } } as MessageEvent)
    await expect(responsePromise).rejects.toThrow('archivo inválido')

    const crashWorker = new FakeWorker()
    const crashPromise = startWorker(crashWorker as unknown as Worker, request(), new AbortController().signal)
    crashWorker.onerror?.({ message: 'boom', preventDefault: vi.fn() } as unknown as ErrorEvent)
    await expect(crashPromise).rejects.toThrow('boom')
  })

  it('rechaza mensajes ilegibles y termina el worker', async () => {
    const worker = new FakeWorker()
    const promise = startWorker(worker as unknown as Worker, request(), new AbortController().signal)
    worker.onmessageerror?.({} as MessageEvent)
    await expect(promise).rejects.toThrow('mensaje que no se pudo leer')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancela inmediatamente, envía cancel y termina', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const promise = startWorker(worker as unknown as Worker, request(), controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted.at(-1)?.message).toEqual({ kind: 'cancel', jobId: 'job-1' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('reporta una lectura multimedia fallida sin crear un worker', async () => {
    const file = { name: 'roto.mp4', type: 'video/mp4', arrayBuffer: () => Promise.reject(new Error('I/O')) } as File
    await expect(runMedia(file, { operation: 'extract-mp3', outputName: 'salida.mp3' }, () => {}, new AbortController().signal)).rejects.toThrow('No se pudo leer')
  })
})
