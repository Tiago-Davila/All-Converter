import type { Converter } from '../converters/types'

export function concurrencyForConverter(converter: Pick<Converter, 'from'>): number {
  return converter.from.some((source) => source.kind === 'audio' || source.kind === 'video') ? 1 : 2
}

function abortReason(): DOMException {
  return new DOMException('Cancelado', 'AbortError')
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
