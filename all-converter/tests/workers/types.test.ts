import { describe, expect, it } from 'vitest'
import type { WorkerRequest, WorkerResponse, WorkerStartRequest } from '../../src/workers/types'
import { requestTransferables, resultTransferables } from '../../src/workers/worker-utils'

describe('canal tipado de workers', () => {
  it('transporta múltiples entradas sin buffers dentro de options', () => {
    const audio = new ArrayBuffer(4)
    const cover = new ArrayBuffer(8)
    const request: WorkerStartRequest = {
      kind: 'start', jobId: 'job-1', operation: 'mp3-to-mp4',
      inputs: [{ name: 'audio.mp3', buffer: audio }, { name: 'cover.png', buffer: cover, mime: 'image/png' }],
      options: { generateWaveform: false, bitrate: 192 },
    }
    expect(requestTransferables(request)).toEqual([audio, cover])
  })

  it('elimina buffers duplicados de la lista de transferibles', () => {
    const buffer = new ArrayBuffer(1)
    const request: WorkerStartRequest = { kind: 'start', jobId: 'job-1', operation: 'merge', inputs: [{ name: 'a', buffer }, { name: 'b', buffer }], options: {} }
    expect(requestTransferables(request)).toEqual([buffer])
  })

  it('define cancelación, progreso, resultado y error como mensajes discriminados', () => {
    const cancel: WorkerRequest = { kind: 'cancel', jobId: 'job-1' }
    const responses: WorkerResponse[] = [
      { kind: 'progress', jobId: 'job-1', progress: { percent: 50, stage: 'Procesando' } },
      { kind: 'result', jobId: 'job-1', results: [] },
      { kind: 'error', jobId: 'job-1', message: 'Falló' },
    ]
    expect(cancel.kind).toBe('cancel')
    expect(responses.map((response) => response.kind)).toEqual(['progress', 'result', 'error'])
  })

  it('transfiere todos los buffers de salida', () => {
    const first = new ArrayBuffer(2)
    const second = new ArrayBuffer(3)
    expect(resultTransferables([
      { name: 'a', mime: 'text/plain', buffer: first, sizeBytes: 2 },
      { name: 'b', mime: 'text/plain', buffer: second, sizeBytes: 3 },
    ])).toEqual([first, second])
  })
})
