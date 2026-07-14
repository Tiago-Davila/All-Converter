import { describe, expect, it } from 'vitest'
import { extractPdfLayout, type PdfDocumentLike } from '../../src/workers/pdf-layout'

describe('extractor de layout PDF', () => {
  it('ordena por página, Y descendente y X ascendente con saltos coherentes', async () => {
    const pageItems = [
      [{ str: 'mundo', transform: [1, 0, 0, 10, 40, 90], width: 30, height: 10 }, { str: 'Hola', transform: [1, 0, 0, 10, 0, 90], width: 20, height: 10 }, { str: 'Título', transform: [1, 0, 0, 20, 0, 120], width: 50, height: 20 }],
      [{ str: 'Segunda página', transform: [1, 0, 0, 10, 0, 100], width: 70, height: 10 }],
    ]
    const pdf: PdfDocumentLike = { numPages: 2, async getPage(page) { return { async getTextContent() { return { items: pageItems[page - 1] } } } } }
    const layout = await extractPdfLayout(pdf)
    expect(layout.pages[0].map((line) => line.text)).toEqual(['Título', 'Hola mundo'])
    expect(layout.text).toBe('Título\nHola mundo\n\nSegunda página')
  })
})
