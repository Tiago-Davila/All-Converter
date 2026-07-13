import { describe, expect, it } from 'vitest'
import { audioConverter } from '../../src/converters/audio'
import { mp3ToMp4Converter } from '../../src/converters/mp3-to-mp4'
import { mp4ToMp3Converter } from '../../src/converters/mp4-to-mp3'
import { getConverterTargets } from '../../src/converters/registry'

describe('media converters', () => {
  it('declara límites y destinos', () => {
    expect(mp4ToMp3Converter.maxSizeMB).toBe(250)
    expect(mp3ToMp4Converter.to).toBe('mp4')
    expect(mp3ToMp4Converter.limitation).toMatch(/portada.*waveform/i)
    expect(audioConverter.maxSizeMB).toBe(100)
  })
  it.todo('convierte tests/fixtures/sample.mp4 a un MP3 reproducible')
  it.todo('rechaza tests/fixtures/silent.mp4 con un mensaje de pista de audio ausente')
  it.todo('convierte tests/fixtures/sample.mp3 a MP4 con portada y waveform')
  it.todo('valida conversiones reales MP3/WAV/OGG/M4A')

  it('expone únicamente pares compatibles y rechaza identidad', async () => {
    const mp3 = { kind: 'audio', mime: 'audio/mpeg', extension: 'mp3', detection: 'magic-bytes' } as const
    const wav = { kind: 'audio', mime: 'audio/wav', extension: 'wav', detection: 'magic-bytes' } as const
    expect(getConverterTargets(audioConverter, mp3)).toEqual(['wav', 'ogg', 'm4a'])
    expect(getConverterTargets(audioConverter, wav)).toEqual(['mp3'])
    const file = new File(['audio'], 'sample.mp3', { type: 'audio/mpeg' })
    await expect(audioConverter.convert(file, () => {}, { format: 'mp3', sourceExtension: 'mp3' }, new AbortController().signal)).rejects.toThrow('ya está')
  })
})
