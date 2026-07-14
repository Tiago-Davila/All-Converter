import { describe, expect, it } from 'vitest'
import { runMediaExclusive } from '../../src/lib/media-pool'

describe('pool multimedia exclusivo', () => {
  it('ejecuta una sola conversión multimedia a la vez', async () => {
    let active = 0; let maximum = 0
    const task = () => runMediaExclusive(async () => { active += 1; maximum = Math.max(maximum, active); await Promise.resolve(); active -= 1 }, new AbortController().signal)
    await Promise.all([task(), task(), task()])
    expect(maximum).toBe(1)
  })

  it('permite cancelar un trabajo mientras espera turno', async () => {
    let release = () => {}
    const blocker = runMediaExclusive(() => new Promise<void>((resolve) => { release = resolve }), new AbortController().signal)
    const controller = new AbortController(); const queued = runMediaExclusive(async () => {}, controller.signal); controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    release(); await blocker
  })
})
