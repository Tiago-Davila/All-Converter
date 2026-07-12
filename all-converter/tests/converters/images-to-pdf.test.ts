import { describe, expect, it } from 'vitest'
import { imagesToPdfConverter } from '../../src/converters/images-to-pdf'
describe('images to PDF', () => { it('declares the image limit', () => expect(imagesToPdfConverter.maxSizeMB).toBe(50)) })
