import { describe, expect, it } from 'vitest'
import { imageConverter } from '../../src/converters/image'

describe('image converter', () => {
  it('declara el límite de imagen', () => expect(imageConverter.maxSizeMB).toBe(50))
})
