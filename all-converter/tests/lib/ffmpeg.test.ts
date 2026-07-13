import { describe, expect, it } from 'vitest'
import { downloadFfmpegAssets, preferredFfmpegMode, supportsMultithreadFfmpeg } from '../../src/lib/ffmpeg'
import { vi } from 'vitest'

describe('ffmpeg capability', () => {
  it('returns a boolean capability', () => expect(typeof supportsMultithreadFfmpeg()).toBe('boolean'))
  it('selects a supported execution mode', () => expect(['multithread', 'single-thread']).toContain(preferredFfmpegMode()))

  it('reporta progreso basado en bytes descargados y libera blob URLs', async () => {
    const progress: number[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:core').mockReturnValueOnce('blob:wasm')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-length': '4', 'content-type': 'application/octet-stream' } })) as typeof fetch
    const downloaded = await downloadFfmpegAssets('single-thread', (percent) => progress.push(percent), fetcher)
    expect(downloaded.assets).toEqual({ coreURL: 'blob:core', wasmURL: 'blob:wasm' })
    expect(progress).toContain(50); expect(progress.at(-1)).toBe(100)
    downloaded.revoke(); expect(revoke).toHaveBeenCalledTimes(2)
    create.mockRestore(); revoke.mockRestore()
  })
})
