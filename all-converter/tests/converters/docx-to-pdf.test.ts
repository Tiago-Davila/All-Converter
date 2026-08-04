import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { docxToPdfConverter } from '../../src/converters/docx-to-pdf'
import { EMU_PER_INCH, documentXml, drawing, packDocx, paragraph, pngOfSize } from '../helpers/docx'

const noop = () => {}
const signal = new AbortController().signal

/** Dimensiones en mm con las que el PDF dibuja cada imagen (operador `cm` del content stream). */
const MM_PER_PT = 25.4 / 72
function drawnImagesMm(buffer: ArrayBuffer): Array<{ w: number; h: number }> {
  const raw = Buffer.from(buffer).toString('latin1')
  const pattern = /\bq\s+([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm\s+\/I\d+ Do\s+Q/g
  return [...raw.matchAll(pattern)].map((match) => ({ w: parseFloat(match[1]) * MM_PER_PT, h: parseFloat(match[2]) * MM_PER_PT }))
}

async function convert(bytes: Uint8Array, name = 'doc.docx') {
  const [result] = await docxToPdfConverter.convert(new File([bytes as BlobPart], name), noop, {}, signal)
  return result
}

describe('DOCX to PDF converter', () => {
  it('uses the Office limit', () => expect(docxToPdfConverter.maxSizeMB).toBe(25))

  it('declara la limitación de fidelidad parcial', () => {
    expect(docxToPdfConverter.limitation).toMatch(/fidelidad parcial/)
  })

  it('DOCX→PDF genera un PDF válido con el contenido', async () => {
    const file = new File([await readFile(new URL('../fixtures/sample.docx', import.meta.url))], 'sample.docx')
    const [result] = await docxToPdfConverter.convert(file, noop, {}, signal)
    expect(result.name).toBe('sample.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
  })

  it('DOCX→PDF ahora incrusta las tablas del documento', async () => {
    const file = new File([await readFile(new URL('../fixtures/table.docx', import.meta.url))], 'table.docx')
    const [result] = await docxToPdfConverter.convert(file, noop, {}, signal)
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })
})

describe('DOCX to PDF — tamaño de las imágenes (005)', () => {
  const image = pngOfSize(200, 100)

  it('dibuja la imagen con el tamaño que declara Word, no al ancho de la página', async () => {
    const docx = await packDocx({
      body: documentXml(paragraph('Con imagen') + drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    const [drawn] = drawnImagesMm((await convert(docx)).buffer)
    expect(drawn.w).toBeCloseTo(50.8, 2) // 2 in
    expect(drawn.h).toBeCloseTo(25.4, 2) // 1 in
  })

  it('un gráfico previo no le roba el tamaño a la imagen', async () => {
    const docx = await packDocx({
      body: documentXml(
        paragraph('Con gráfico') +
          drawing({ cx: 5486400, cy: 3200400 }) +
          drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH }),
      ),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    const drawn = drawnImagesMm((await convert(docx)).buffer)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].w).toBeCloseTo(50.8, 2)
  })

  it('sin wp:extent cae a los píxeles intrínsecos a 96 dpi', async () => {
    const docx = await packDocx({
      body: documentXml(paragraph('Sin tamaño') + drawing({ relationshipId: 'rId1' })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    const [drawn] = drawnImagesMm((await convert(docx)).buffer)
    expect(drawn.w).toBeCloseTo((200 * 25.4) / 96, 2)
    expect(drawn.h).toBeCloseTo((100 * 25.4) / 96, 2)
  })

  it('cada imagen conserva su propio tamaño', async () => {
    const otra = pngOfSize(64, 64)
    const docx = await packDocx({
      body: documentXml(
        paragraph('Dos imágenes') +
          drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH }) +
          drawing({ relationshipId: 'rId2', cx: EMU_PER_INCH, cy: EMU_PER_INCH }),
      ),
      relationships: { rId1: 'media/a.png', rId2: 'media/b.png' },
      media: { 'word/media/a.png': image, 'word/media/b.png': otra },
    })
    const drawn = drawnImagesMm((await convert(docx)).buffer)
    expect(drawn).toHaveLength(2)
    expect(drawn[0].w).toBeCloseTo(50.8, 2)
    expect(drawn[1].w).toBeCloseTo(25.4, 2)
  })

  it('el texto del documento se conserva junto a la imagen', async () => {
    const docx = await packDocx({
      body: documentXml(paragraph('Producto') + drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH, cy: EMU_PER_INCH })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    const result = await convert(docx)
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })
})
