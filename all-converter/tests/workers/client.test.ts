import { describe, expect, it } from 'vitest'
import { requestTransferables } from '../../src/workers/worker-utils'
import type { WorkerStartRequest } from '../../src/workers/types'

describe('worker utils', () => {
  it('marca todas las entradas como transferibles', () => {
    const request: WorkerStartRequest = { kind: 'start', jobId: 'job', operation: 'test', inputs: [{ name: 'a', buffer: new ArrayBuffer(1) }], options: {} }
    expect(requestTransferables(request)).toHaveLength(1)
  })
})
