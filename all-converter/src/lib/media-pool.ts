let tail: Promise<void> = Promise.resolve()

export async function runMediaExclusive<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let release = () => {}
  const slot = new Promise<void>((resolve) => { release = resolve })
  const previous = tail
  tail = previous.then(() => slot)

  if (signal.aborted) { previous.then(release); throw new DOMException('Cancelado', 'AbortError') }
  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => { abort = () => reject(new DOMException('Cancelado', 'AbortError')); signal.addEventListener('abort', abort, { once: true }) })
  try {
    await Promise.race([previous, aborted])
  } catch (error) {
    previous.then(release)
    throw error
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
  try { return await task() } finally { release() }
}
