import { describe, expect, it } from 'vitest'
import { inferDocumentBlocks, type DocumentBlock } from '../../src/workers/pdf-docx-structure'
import type { PdfLayoutLine, PdfLayoutSpan } from '../../src/workers/pdf-layout'

const line = (text: string, fontSize: number, x: number, y: number, page = 1): PdfLayoutLine => ({ text, fontSize, x, y, page })
const runsText = (block: DocumentBlock | undefined): string => (block && 'runs' in block ? block.runs.map((run) => run.text).join('') : '')

/** Línea con celdas (spans) en posiciones x dadas, para tablas y estilos. */
function cells(items: { text: string; x: number; bold?: boolean; italic?: boolean }[], fontSize: number, y: number): PdfLayoutLine {
  const spans: PdfLayoutSpan[] = items.map((item) => ({ text: item.text, x: item.x, xEnd: item.x + 30, bold: !!item.bold, italic: !!item.italic }))
  return { page: 1, fontSize, y, x: items[0].x, text: items.map((item) => item.text).join(' '), spans }
}

describe('heurísticas PDF→DOCX', () => {
  it('clasifica títulos con umbrales 1.8x y 1.35x', () => {
    const blocks = inferDocumentBlocks([[line('Título', 20, 0, 100), line('Subtítulo', 14, 0, 80), line('Cuerpo', 10, 0, 60), line('más cuerpo', 10, 0, 50)]])
    expect(blocks.map((block) => block.kind)).toEqual(['heading1', 'heading2', 'paragraph'])
  })

  it('separa párrafos por espaciado e indentación y detecta listas consecutivas', () => {
    const blocks = inferDocumentBlocks([[line('Primera línea', 10, 0, 100), line('continuación', 10, 0, 90), line('Otro párrafo', 10, 30, 80), line('• Uno', 10, 0, 60), line('• Dos', 10, 20, 50)]])
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'list', 'list'])
    const last = blocks.at(-1)
    expect(last?.kind).toBe('list')
    if (last?.kind === 'list') expect(last.level).toBe(1)
    expect(runsText(last)).toBe('Dos')
  })

  it('reconstruye una tabla a partir de columnas alineadas', () => {
    const blocks = inferDocumentBlocks([[
      cells([{ text: 'Producto', x: 0 }, { text: 'Precio', x: 200 }], 10, 100),
      cells([{ text: 'Café', x: 0 }, { text: '100', x: 200 }], 10, 88),
    ]])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('table')
    if (blocks[0].kind === 'table') expect(blocks[0].rows).toEqual([['Producto', 'Precio'], ['Café', '100']])
  })

  it('preserva negrita e itálica en runs sin confundir con tabla', () => {
    const blocks = inferDocumentBlocks([[
      cells([{ text: 'normal', x: 0 }, { text: 'fuerte', x: 31, bold: true }, { text: 'tenue', x: 62, italic: true }], 10, 100),
    ]])
    expect(blocks[0].kind).toBe('paragraph')
    if (blocks[0].kind === 'paragraph') {
      expect(blocks[0].runs.find((run) => run.text.includes('fuerte'))?.bold).toBe(true)
      expect(blocks[0].runs.find((run) => run.text.includes('tenue'))?.italic).toBe(true)
      expect(blocks[0].runs.find((run) => run.text.includes('normal'))?.bold).toBe(false)
    }
  })
})
