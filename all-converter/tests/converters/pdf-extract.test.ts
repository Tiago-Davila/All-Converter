import { describe, expect, it } from 'vitest'
import { pdfTextConverter } from '../../src/converters/pdf-extract'
describe('PDF extraction', () => { it('uses the PDF limit', () => expect(pdfTextConverter.maxSizeMB).toBe(25)) })
