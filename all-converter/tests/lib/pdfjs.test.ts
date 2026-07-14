import { describe, expect, it } from 'vitest'
import { loadPdfJs } from '../../src/lib/pdfjs'
describe('PDF.js loader', () => { it('loads PDF.js locally', async () => expect(await loadPdfJs()).toBeDefined()) })
