import { describe, expect, it } from 'vitest'
import { imagesToPdfConverter } from '../../src/converters/images-to-pdf'

describe('images to PDF', () => {
  it('declara el límite de imagen', () => expect(imagesToPdfConverter.maxSizeMB).toBe(50))
  it.todo('combina múltiples imágenes en un único PDF preservando el orden')
  it.todo('rasteriza WebP antes de insertarlo en PDF')
})
