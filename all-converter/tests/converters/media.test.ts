import { describe, expect, it } from 'vitest'
import { mp4ToMp3Converter } from '../../src/converters/mp4-to-mp3'; import { mp3ToMp4Converter } from '../../src/converters/mp3-to-mp4'; import { audioConverter } from '../../src/converters/audio'
describe('media converters', () => { it('uses specified limits and destinations', () => { expect(mp4ToMp3Converter.maxSizeMB).toBe(250); expect(mp3ToMp4Converter.to).toBe('mp4'); expect(mp3ToMp4Converter.limitation).toMatch(/portada.*waveform/i); expect(audioConverter.maxSizeMB).toBe(100) }) })
