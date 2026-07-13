export type FfmpegMode = 'multithread' | 'single-thread'

export interface FfmpegAssets {
  coreURL: string
  wasmURL: string
  workerURL?: string
}

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
