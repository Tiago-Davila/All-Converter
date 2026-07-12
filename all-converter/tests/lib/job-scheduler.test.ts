import { describe, expect, it } from 'vitest'
import { runWithConcurrency } from '../../src/lib/job-scheduler'
describe('scheduler', () => { it('keeps successful and failed results', async () => expect(await runWithConcurrency([async () => 1, async () => { throw new Error('x') }])).toHaveLength(2)) })
