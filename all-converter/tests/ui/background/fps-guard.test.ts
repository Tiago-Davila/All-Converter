import { describe, it, expect, vi } from 'vitest'
import { createFpsGuard } from '../../../src/ui/background/fps-guard'

/**
 * Simula N frames a una tasa constante de fps, empezando desde startTs.
 * Devuelve el timestamp final.
 */
function simulateFrames(
  guard: ReturnType<typeof createFpsGuard>,
  fps: number,
  durationMs: number,
  startTs: number,
): number {
  const interval = 1000 / fps
  let ts = startTs
  while (ts < startTs + durationMs) {
    guard.tick(ts)
    ts += interval
  }
  return ts
}

describe('FpsGuard (T029)', () => {
  it('no degrada si los FPS están por encima del umbral', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    // 1 s warmup + 3 s a 60 fps
    simulateFrames(guard, 60, 3500, 0)

    expect(onDegrade).not.toHaveBeenCalled()
    guard.destroy()
  })

  it('no degrada durante el warmup aunque los FPS sean bajos', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    // Solo 400 ms a 10 fps (dentro del warmup)
    simulateFrames(guard, 10, 400, 0)

    expect(onDegrade).not.toHaveBeenCalled()
    guard.destroy()
  })

  it('degrada cuando la media cae bajo el umbral durante sustainMs tras warmup', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    // Warmup: 500 ms a 60 fps
    const ts = simulateFrames(guard, 60, 500, 0)
    // Caída: 2500 ms a 10 fps (bien bajo el umbral)
    simulateFrames(guard, 10, 2500, ts)

    expect(onDegrade).toHaveBeenCalledTimes(1)
    guard.destroy()
  })

  it('no reintenta: onDegrade se llama solo una vez', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    let ts = simulateFrames(guard, 60, 500, 0)
    ts = simulateFrames(guard, 10, 3000, ts)
    // Seguir enviando ticks después de degradar
    simulateFrames(guard, 10, 2000, ts)

    expect(onDegrade).toHaveBeenCalledTimes(1)
    guard.destroy()
  })

  it('resetea el contador si los FPS suben sobre el umbral', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    let ts = simulateFrames(guard, 60, 500, 0)  // warmup
    ts = simulateFrames(guard, 10, 1500, ts)      // bajo umbral 1.5 s (< sustain 2 s)
    ts = simulateFrames(guard, 60, 1000, ts)      // recupera
    simulateFrames(guard, 10, 1500, ts)            // cae de nuevo, < 2 s

    expect(onDegrade).not.toHaveBeenCalled()
    guard.destroy()
  })

  it('destroy() impide cualquier efecto posterior', () => {
    const onDegrade = vi.fn()
    const guard = createFpsGuard(30, 2000, 500, onDegrade)

    guard.destroy()
    simulateFrames(guard, 5, 5000, 0)

    expect(onDegrade).not.toHaveBeenCalled()
  })
})
