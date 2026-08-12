import { describe, expect, it } from 'vitest'
import { concurrencyForConverter, runPartitioned, runWithConcurrency } from '../../src/lib/job-scheduler'
import { AUDIO_SOURCE, IMAGE_SOURCE } from '../../src/converters/sources'

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

  it('asigna concurrencia 1 a media y 2 a conversiones livianas', () => {
    expect(concurrencyForConverter({ from: [AUDIO_SOURCE] })).toBe(1)
    expect(concurrencyForConverter({ from: [IMAGE_SOURCE] })).toBe(2)
  })
})

describe('scheduler particionado (FR-017)', () => {
  /** Trabajo que registra cuántos corren a la vez dentro de su propio grupo. */
  function tracker() {
    const state = { active: 0, maximum: 0 }
    const job = (value: string) => async () => {
      state.active += 1
      state.maximum = Math.max(state.maximum, state.active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      state.active -= 1
      return value
    }
    return { state, job }
  }

  it('cada grupo respeta su tope y un trabajo de a 1 no frena a los de a 2', async () => {
    const media = tracker()
    const light = tracker()
    const jobs = [
      { run: media.job('mp3-1'), limit: 1 },
      ...Array.from({ length: 5 }, (_, index) => ({ run: light.job(`img-${index}`), limit: 2 })),
      { run: media.job('mp3-2'), limit: 1 },
    ]

    const results = await runPartitioned(jobs)

    expect(media.state.maximum).toBe(1)
    expect(light.state.maximum).toBe(2)
    expect(results.map((result) => (result.status === 'fulfilled' ? result.value : result.reason))).toEqual([
      'mp3-1', 'img-0', 'img-1', 'img-2', 'img-3', 'img-4', 'mp3-2',
    ])
  })

  it('conserva errores en su índice y no arranca pendientes después de cancelar', async () => {
    const controller = new AbortController()
    const error = new Error('roto')
    let started = 0
    const results = await runPartitioned([
      { run: async () => { started += 1; throw error }, limit: 2 },
      { run: async () => { started += 1; controller.abort(); return 'ok' }, limit: 1 },
      { run: async () => { started += 1; return 'no debe correr' }, limit: 1 },
    ], controller.signal)

    expect(results[0]).toEqual({ status: 'rejected', reason: error })
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' })
    expect(results[2].status).toBe('rejected')
    expect(started).toBe(2)
  })

  it('sin trabajos devuelve una lista vacía', async () => {
    await expect(runPartitioned([])).resolves.toEqual([])
  })
})
