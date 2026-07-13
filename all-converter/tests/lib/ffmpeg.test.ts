import { describe, expect, it } from 'vitest'
import { supportsMultithreadFfmpeg } from '../../src/lib/ffmpeg'
describe('ffmpeg capability', () => { it('returns a boolean capability', () => expect(typeof supportsMultithreadFfmpeg()).toBe('boolean') })
