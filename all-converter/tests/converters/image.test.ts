import { describe, expect, it } from 'vitest'
import { imageConverter } from '../../src/converters/image'
describe('image converter', () => { it('declares the image limit', () => expect(imageConverter.maxSizeMB).toBe(50)) })
