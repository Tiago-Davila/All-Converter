export async function runWithConcurrency<T>(jobs: readonly (() => Promise<T>)[], limit = 2): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []; let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => { while (cursor < jobs.length) { const job = jobs[cursor++]; results.push(await job().then((value) => ({ status: 'fulfilled', value } as const), (reason) => ({ status: 'rejected', reason } as const))) } }))
  return results
}
