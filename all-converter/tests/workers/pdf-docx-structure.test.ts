import { describe, expect, it } from 'vitest'
import { inferDocumentBlocks } from '../../src/workers/pdf-docx-structure'
import type { PdfLayoutLine } from '../../src/workers/pdf-layout'

const line = (text: string, fontSize: number, x: number, y: number, page = 1): PdfLayoutLine => ({ text, fontSize, x, y, page })

describe('heurísticas PDF→DOCX', () => {
  it('clasifica títulos con umbrales 1.8x y 1.35x', () => {
    const blocks = inferDocumentBlocks([[line('Título', 20, 0, 100), line('Subtítulo', 14, 0, 80), line('Cuerpo', 10, 0, 60), line('más cuerpo', 10, 0, 50)]])
    expect(blocks.map((block) => block.kind)).toEqual(['heading1', 'heading2', 'paragraph'])
  })

  it('separa párrafos por espaciado e indentación y detecta listas consecutivas', () => {
    const blocks = inferDocumentBlocks([[line('Primera línea', 10, 0, 100), line('continuación', 10, 0, 90), line('Otro párrafo', 10, 30, 80), line('• Uno', 10, 0, 60), line('• Dos', 10, 20, 50)]])
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'list', 'list'])
    expect(blocks.at(-1)).toMatchObject({ kind: 'list', level: 1, text: 'Dos' })
  })
})
