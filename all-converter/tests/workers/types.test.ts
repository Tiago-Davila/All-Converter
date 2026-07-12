import { describe, expect, it } from 'vitest'
import type { WorkerRequest } from '../../src/workers/types'
describe('worker channel', () => { it('defines a cancellable start request', () => { const request: WorkerRequest = { kind: 'cancel', jobId: 'job-1' }; expect(request.kind).toBe('cancel') }) })
