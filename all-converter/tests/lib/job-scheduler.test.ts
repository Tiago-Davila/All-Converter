import { describe, expect, it } from 'vitest'
import { runWithConcurrency } from '../../src/lib/job-scheduler'

describe('scheduler', () => {
  it('preserva el orden de entrada aunque los trabajos terminen desordenados', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<void>((resolve) => { releaseFirst = resolve })
    const resultsPromise = runWithConcurrency([
      async () => { await first; return 'primero' },
      async () => { releaseFirst?.(); return 'segundo' },
      async () => 'tercero',
    ], 2)
    expect(await resultsPromise).toEqual([
      { status: 'fulfilled', value: 'primero' },
      { status: 'fulfilled', value: 'segundo' },
      { status: 'fulfilled', value: 'tercero' },
    ])
  })

  it('nunca supera el límite de concurrencia', async () => {
    let active = 0
    let maximum = 0
    const jobs = Array.from({ length: 6 }, () => async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active -= 1
    })
    await runWithConcurrency(jobs, 2)
    expect(maximum).toBe(2)
  })

  it('conserva éxitos y errores en su índice original', async () => {
    const error = new Error('x')
    const results = await runWithConcurrency([async () => 1, async () => { throw error }, async () => 3])
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1]).toEqual({ status: 'rejected', reason: error })
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('no inicia trabajos pendientes después de cancelar', async () => {
    const controller = new AbortController()
    let pendingRuns = 0
    const results = await runWithConcurrency([
      async () => { controller.abort(); return 'completado' },
      async () => { pendingRuns += 1; return 'no debe correr' },
      async () => { pendingRuns += 1; return 'no debe correr' },
    ], 1, controller.signal)
    expect(pendingRuns).toBe(0)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'completado' })
    expect(results.slice(1).every((result) => result.status === 'rejected' && result.reason instanceof DOMException && result.reason.name === 'AbortError')).toBe(true)
  })

  it('rechaza límites inválidos', async () => {
    await expect(runWithConcurrency([], 0)).rejects.toThrow(RangeError)
  })
})
