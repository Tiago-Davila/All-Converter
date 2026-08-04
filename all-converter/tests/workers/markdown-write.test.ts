import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, escapeMarkdown } from '../../src/workers/markdown-write'
import { markdownToBlocks } from '../../src/workers/markdown-parse'
import type { DocumentBlock } from '../../src/workers/pdf-docx-structure'

const run = (text: string, bold = false, italic = false) => ({ text, bold, italic })
const para = (text: string): DocumentBlock => ({ kind: 'paragraph', runs: [run(text)], pageBreakBefore: false })

describe('escapeMarkdown', () => {
  it('escapa los caracteres que reintroducirían marcado', () => {
    expect(escapeMarkdown('a*b_c[d]e#f|g`h')).toBe('a\\*b\\_c\\[d\\]e\\#f\\|g\\`h')
  })

  it('escapa la barra invertida antes que el resto', () => {
    expect(escapeMarkdown('c:\\ruta')).toBe('c:\\\\ruta')
    expect(escapeMarkdown('\\*')).toBe('\\\\\\*')
  })

  it('deja el texto común intacto', () => {
    expect(escapeMarkdown('Un texto normal, con coma.')).toBe('Un texto normal, con coma.')
  })
})

describe('blocksToMarkdown', () => {
  it('escribe los encabezados con su nivel', () => {
    const markdown = blocksToMarkdown([
      { kind: 'heading1', runs: [run('Título')], pageBreakBefore: false },
      { kind: 'heading2', runs: [run('Subtítulo')], pageBreakBefore: false },
    ])
    expect(markdown).toBe('# Título\n\n## Subtítulo\n')
  })

  it('separa los párrafos con una línea en blanco', () => {
    expect(blocksToMarkdown([para('Uno'), para('Dos')])).toBe('Uno\n\nDos\n')
  })

  it('escribe las listas con viñeta y sangría por nivel', () => {
    const markdown = blocksToMarkdown([
      { kind: 'list', runs: [run('padre')], level: 0, pageBreakBefore: false },
      { kind: 'list', runs: [run('hijo')], level: 1, pageBreakBefore: false },
    ])
    expect(markdown).toBe('- padre\n  - hijo\n')
  })

  it('escribe las tablas en formato GFM con su fila separadora', () => {
    const markdown = blocksToMarkdown([
      { kind: 'table', rows: [['Producto', 'Precio'], ['Café', '100']], pageBreakBefore: false },
    ])
    expect(markdown).toBe('| Producto | Precio |\n| --- | --- |\n| Café | 100 |\n')
  })

  it('rellena las filas cortas para que la tabla quede rectangular', () => {
    const markdown = blocksToMarkdown([
      { kind: 'table', rows: [['a', 'b', 'c'], ['1']], pageBreakBefore: false },
    ])
    expect(markdown.split('\n')[2]).toBe('| 1 |   |   |')
  })

  it('neutraliza una barra vertical dentro de una celda', () => {
    const markdown = blocksToMarkdown([{ kind: 'table', rows: [['a|b'], ['c']], pageBreakBefore: false }])
    expect(markdown).toContain('a\\|b')
  })

  it('aplica los delimitadores de negrita e itálica', () => {
    const markdown = blocksToMarkdown([
      { kind: 'paragraph', runs: [run('normal '), run('fuerte', true), run(' y '), run('tenue', false, true)], pageBreakBefore: false },
    ])
    expect(markdown).toBe('normal **fuerte** y *tenue*\n')
  })

  it('usa el triple delimitador cuando el run es negrita e itálica', () => {
    const markdown = blocksToMarkdown([{ kind: 'paragraph', runs: [run('ambas', true, true)], pageBreakBefore: false }])
    expect(markdown).toBe('***ambas***\n')
  })

  it('deja los espacios fuera de los delimitadores', () => {
    const markdown = blocksToMarkdown([
      { kind: 'paragraph', runs: [run('a'), run(' fuerte ', true), run('b')], pageBreakBefore: false },
    ])
    expect(markdown).toBe('a **fuerte** b\n')
  })

  it('escapa lo que abriría un bloque al principio de línea', () => {
    expect(blocksToMarkdown([para('1. no es una lista')])).toBe('1\\. no es una lista\n')
    expect(blocksToMarkdown([para('- tampoco')])).toBe('\\- tampoco\n')
  })

  it('omite los bloques sin texto', () => {
    expect(blocksToMarkdown([para('   '), { kind: 'paragraph', runs: [], pageBreakBefore: false }])).toBe('')
  })

  it('devuelve una cadena vacía sin bloques', () => {
    expect(blocksToMarkdown([])).toBe('')
  })
})

describe('ida y vuelta', () => {
  it('el texto escapado no se reinterpreta como marcado al releerlo', () => {
    const original = 'un *asterisco* literal y un | pipe'
    const markdown = blocksToMarkdown([{ kind: 'paragraph', runs: [run(original)], pageBreakBefore: false }])
    const blocks = markdownToBlocks(markdown)
    expect(blocks).toHaveLength(1)
    const text = blocks[0].type === 'para' ? blocks[0].runs.map((entry) => entry.text).join('') : ''
    expect(text).toBe(original)
  })

  it('la estructura sobrevive al ida y vuelta', () => {
    const markdown = blocksToMarkdown([
      { kind: 'heading1', runs: [run('Informe')], pageBreakBefore: false },
      { kind: 'paragraph', runs: [run('Un párrafo.')], pageBreakBefore: false },
      { kind: 'list', runs: [run('uno')], level: 0, pageBreakBefore: false },
      { kind: 'list', runs: [run('dos')], level: 0, pageBreakBefore: false },
      { kind: 'table', rows: [['a', 'b'], ['1', '2']], pageBreakBefore: false },
    ])
    expect(markdownToBlocks(markdown).map((block) => block.type)).toEqual(['heading', 'para', 'list', 'table'])
  })
})
