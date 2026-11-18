import type { Converter } from '../converters/types'

/** Audio y video pesan distinto: mandan la concurrencia y el plazo del watchdog. */
function isMediaConverter(converter: Pick<Converter, 'from'>): boolean {
  return converter.from.some((source) => source.kind === 'audio' || source.kind === 'video')
}

export function concurrencyForConverter(converter: Pick<Converter, 'from'>): number {
  return isMediaConverter(converter) ? 1 : 2
}

/**
 * Plazo SIN avance tras el cual se aborta ese archivo (006 FR-015,
 * contracts/reliability.md §Watchdog). Mide ausencia de progreso, no duración total: una
 * conversión larga que reporta avance no se aborta nunca.
 *
 * Audio y video tienen plazo más largo porque ffmpeg-WASM es legítimamente lento y
 * `mp4-to-mp3` admite archivos de 250 MB.
 */
export const WATCHDOG_MS = 300_000
export const WATCHDOG_MS_MEDIA = 900_000

export function watchdogMsForConverter(converter: Pick<Converter, 'from'>): number {
  return isMediaConverter(converter) ? WATCHDOG_MS_MEDIA : WATCHDOG_MS
}

function abortReason(): DOMException {
  return new DOMException('Cancelado', 'AbortError')
}

/**
 * Compuerta de pausa del lote (006 FR-018/FR-019, contracts/job-scheduler.md).
 *
 * Pausar NO interrumpe lo que ya está en vuelo: sólo frena el despacho de trabajos nuevos.
 * Reanudar continúa donde iba, sin reiniciar el cursor ni saltear nada.
 */
export interface PauseGate {
  readonly paused: boolean
  /** Resuelve al reanudar; inmediato si no está pausada. */
  wait(): Promise<void>
  pause(): void
  resume(): void
}

export function createPauseGate(): PauseGate {
  let paused = false
  let waiters: (() => void)[] = []
  return {
    get paused() { return paused },
    wait: () => (paused ? new Promise<void>((resolve) => { waiters.push(resolve) }) : Promise.resolve()),
    pause: () => { paused = true },
    resume: () => {
      paused = false
      const pending = waiters
      waiters = []
      for (const resolve of pending) resolve()
    },
  }
}

/**
 * Espera a que se reanude, pero cancelar mientras está pausado también despierta al runner:
 * pausa y cancelación son ortogonales (FR-020). Sin esto, cancelar un lote pausado colgaría
 * la promesa del lote hasta un `resume` que quizá nunca llegue.
 */
async function waitWhilePaused(gate: PauseGate, signal?: AbortSignal): Promise<void> {
  while (gate.paused && !signal?.aborted) {
    if (!signal) { await gate.wait(); continue }
    await new Promise<void>((resolve) => {
      const onAbort = () => resolve()
      signal.addEventListener('abort', onAbort, { once: true })
      void gate.wait().then(() => { signal.removeEventListener('abort', onAbort); resolve() })
    })
  }
}

/** Un trabajo con el tope de concurrencia del grupo al que pertenece. */
export interface PartitionedJob<T> { run: () => Promise<T>; limit: number }

/**
 * Corre los trabajos partidos por tope de concurrencia, con los grupos avanzando en paralelo
 * y cada uno respetando el suyo (006 FR-017, contracts/job-scheduler.md §Particionado).
 *
 * Antes la concurrencia del lote era el mínimo de todos los conversores elegidos, así que un
 * solo MP3 entre 199 imágenes bajaba el lote entero a 1. La serialización real de ffmpeg la
 * garantiza `runMediaExclusive` aparte, no ese mínimo global.
 *
 * Los resultados vuelven en el orden de entrada, como en `runWithConcurrency`.
 */
export async function runPartitioned<T>(
  jobs: readonly PartitionedJob<T>[],
  signal?: AbortSignal,
  gate?: PauseGate,
): Promise<PromiseSettledResult<T>[]> {
  const groups = new Map<number, number[]>()
  jobs.forEach((job, index) => {
    const indices = groups.get(job.limit) ?? []
    indices.push(index)
    groups.set(job.limit, indices)
  })

  const results = new Array<PromiseSettledResult<T>>(jobs.length)
  await Promise.all([...groups].map(async ([limit, indices]) => {
    const settled = await runWithConcurrency(indices.map((index) => jobs[index].run), limit, signal, gate)
    settled.forEach((result, position) => { results[indices[position]] = result })
  }))
  return results
}

export async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  limit = 2,
  signal?: AbortSignal,
  gate?: PauseGate,
): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('La concurrencia debe ser un entero mayor o igual a 1.')

  const results = new Array<PromiseSettledResult<T>>(jobs.length)
  let cursor = 0

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      // La pausa se consulta ANTES de tomar el índice: lo en vuelo termina, lo nuevo espera.
      if (gate) await waitWhilePaused(gate, signal)
      if (cursor >= jobs.length) return
      const index = cursor++
      if (signal?.aborted) {
        results[index] = { status: 'rejected', reason: abortReason() }
        continue
      }
      try {
        results[index] = { status: 'fulfilled', value: await jobs[index]() }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))

  return results
}
