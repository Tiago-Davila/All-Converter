import type { Converter } from '../converters/types'

export function concurrencyForConverter(converter: Pick<Converter, 'from'>): number {
  return converter.from.some((source) => source.kind === 'audio' || source.kind === 'video') ? 1 : 2
}

function abortReason(): DOMException {
  return new DOMException('Cancelado', 'AbortError')
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
): Promise<PromiseSettledResult<T>[]> {
  const groups = new Map<number, number[]>()
  jobs.forEach((job, index) => {
    const indices = groups.get(job.limit) ?? []
    indices.push(index)
    groups.set(job.limit, indices)
  })

  const results = new Array<PromiseSettledResult<T>>(jobs.length)
  await Promise.all([...groups].map(async ([limit, indices]) => {
    const settled = await runWithConcurrency(indices.map((index) => jobs[index].run), limit, signal)
    settled.forEach((result, position) => { results[indices[position]] = result })
  }))
  return results
}

export async function runWithConcurrency<T>(
  jobs: readonly (() => Promise<T>)[],
  limit = 2,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('La concurrencia debe ser un entero mayor o igual a 1.')

  const results = new Array<PromiseSettledResult<T>>(jobs.length)
  let cursor = 0

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (cursor < jobs.length) {
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
