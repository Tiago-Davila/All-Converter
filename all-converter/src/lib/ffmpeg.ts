export type FfmpegMode = 'multithread' | 'single-thread'

export interface FfmpegAssets {
  coreURL: string
  wasmURL: string
  workerURL?: string
}
export interface DownloadedFfmpegAssets { assets: FfmpegAssets; revoke(): void }

export function supportsMultithreadFfmpeg(): boolean {
  return globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined'
}

export function preferredFfmpegMode(): FfmpegMode {
  return supportsMultithreadFfmpeg() ? 'multithread' : 'single-thread'
}

export async function loadFfmpegAssets(mode: FfmpegMode): Promise<FfmpegAssets> {
  if (mode === 'multithread') {
    const [core, wasm, worker] = await Promise.all([
      import('@ffmpeg/core-mt?url'),
      import('@ffmpeg/core-mt/wasm?url'),
      import('@ffmpeg/core-mt/worker?url'),
    ])
    return { coreURL: core.default, wasmURL: wasm.default, workerURL: worker.default }
  }

  const [core, wasm] = await Promise.all([
    import('@ffmpeg/core?url'),
    import('@ffmpeg/core/wasm?url'),
  ])
  return { coreURL: core.default, wasmURL: wasm.default }
}

export async function downloadFfmpegAssets(mode: FfmpegMode, onProgress: (percent: number) => void, fetcher: typeof fetch = fetch): Promise<DownloadedFfmpegAssets> {
  const source = await loadFfmpegAssets(mode)
  const entries = Object.entries(source).filter((entry): entry is [keyof FfmpegAssets, string] => typeof entry[1] === 'string')
  const urls: string[] = []
  const downloaded: Partial<FfmpegAssets> = {}
  try {
    for (const [index, [key, url]] of entries.entries()) {
      const response = await fetcher(url)
      if (!response.ok || !response.body) throw new Error(`No se pudo descargar ${key} de ffmpeg.`)
      const total = Number(response.headers.get('content-length')) || 0
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let loaded = 0
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); loaded += value.byteLength; const fraction = total > 0 ? Math.min(1, loaded / total) : 0; onProgress(Math.round(((index + fraction) / entries.length) * 100)) }
      } finally {
        reader.releaseLock()
      }
      const blobUrl = URL.createObjectURL(new Blob(chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer), { type: response.headers.get('content-type') ?? 'application/octet-stream' }))
      urls.push(blobUrl); downloaded[key] = blobUrl; onProgress(Math.round(((index + 1) / entries.length) * 100))
    }
    return { assets: downloaded as FfmpegAssets, revoke: () => urls.forEach((url) => URL.revokeObjectURL(url)) }
  } catch (error) { urls.forEach((url) => URL.revokeObjectURL(url)); throw error }
}
