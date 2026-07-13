import { describe, expect, it } from 'vitest'
import { preferredFfmpegMode, supportsMultithreadFfmpeg } from '../../src/lib/ffmpeg'

describe('ffmpeg capability', () => {
  it('returns a boolean capability', () => expect(typeof supportsMultithreadFfmpeg()).toBe('boolean'))
  it('selects a supported execution mode', () => expect(['multithread', 'single-thread']).toContain(preferredFfmpegMode()))
})
