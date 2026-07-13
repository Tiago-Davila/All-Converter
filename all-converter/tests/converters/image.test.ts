import { describe, expect, it } from 'vitest'
import { imageConverter } from '../../src/converters/image'

describe('image converter', () => {
  it('declara el límite de imagen', () => expect(imageConverter.maxSizeMB).toBe(50))
  it.todo('convierte tests/fixtures/sample.png a JPG y WebP reales respetando dimensiones y calidad')
  it.todo('rechaza tests/fixtures/animated.webp usando el fixture real')
})
