/**
 * fps-guard.ts: detector de bajo rendimiento para el fondo animado (T029, FR-004).
 * - Descarta los primeros warmupMs (~500 ms) como no representativos
 * - Media móvil de FPS sobre una ventana deslizante
 * - Si el promedio cae bajo `threshold` fps durante `sustainMs` ms consecutivos → llama onDegrade
 * - Una vez degradado, no reintenta en la sesión (FR-004b)
 */

export interface FpsGuard {
  /** Llamar en cada frame con el timestamp de rAF (ms). */
  tick(ts: number): void
  destroy(): void
}

/**
 * @param threshold   FPS mínimo (default 30)
 * @param sustainMs   Duración mínima bajo el umbral para degradar (default 2000 ms)
 * @param warmupMs    Período de calentamiento descartado (default 500 ms)
 * @param onDegrade   Callback cuando se decide degradar. Se llama una sola vez.
 */
export function createFpsGuard(
  threshold: number,
  sustainMs: number,
  warmupMs: number,
  onDegrade: () => void,
): FpsGuard {
  let startTs: number | null = null
  let lastTs: number | null = null
  let belowSince: number | null = null
  let degraded = false
  let destroyed = false

  // Ventana de muestras para la media móvil (últimos N frames)
  const WINDOW = 20
  const samples: number[] = []

  function tick(ts: number): void {
    if (destroyed || degraded) return

    if (startTs === null) {
      startTs = ts
      lastTs = ts
      return
    }

    // Warmup: descartar los primeros warmupMs
    if (ts - startTs < warmupMs) {
      lastTs = ts
      return
    }

    const dt = ts - (lastTs ?? ts)
    lastTs = ts

    if (dt <= 0) return

    const fps = 1000 / dt
    samples.push(fps)
    if (samples.length > WINDOW) samples.shift()

    if (samples.length < 3) return // esperar al menos 3 muestras

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length

    if (avg < threshold) {
      if (belowSince === null) belowSince = ts
      if (ts - belowSince >= sustainMs) {
        degraded = true
        onDegrade()
      }
    } else {
      belowSince = null
    }
  }

  function destroy(): void {
    destroyed = true
  }

  return { tick, destroy }
}
