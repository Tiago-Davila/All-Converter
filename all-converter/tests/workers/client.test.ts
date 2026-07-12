import { describe, expect, it } from 'vitest'
import { transferableResult } from '../../src/workers/worker-utils'
describe('worker utils', () => { it('marks buffers as transferables', () => expect(transferableResult(new ArrayBuffer(1))).toHaveLength(1)) })
