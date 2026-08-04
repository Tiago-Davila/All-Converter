import { describe, expect, it } from 'vitest'
import { inlineMarkdownRuns, markdownToBlocks } from '../../src/workers/markdown-parse'
import type { Block } from '../../src/workers/office-doc-render'
import { PNG_1x1_BASE64 } from '../helpers/odf'

const typesOf = (blocks: Block[]) => blocks.map((block) => block.type)
const textOf = (block: Block) => ('runs' in block ? block.runs.map((run) => run.text).join('') : '')
const find = <T extends Block['type']>(blocks: Block[], type: T) =>
  blocks.find((block) => block.type === type) as Extract<Block, { type: T }>

describe('inlineMarkdownRuns', () => {
  it('marca negrita e itálica', () => {
    const runs = inlineMarkdownRuns('normal **fuerte** y *tenue*')
    expect(runs.find((run) => run.text.includes('fuerte'))?.bold).toBe(true)
    expect(runs.find((run) => run.text.includes('tenue'))?.italic).toBe(true)
  })

  it('acepta las variantes con guion bajo', () => {
    expect(inlineMarkdownRuns('__fuerte__').find((run) => run.bold)?.text).toBe('fuerte')
    expect(inlineMarkdownRuns('_tenue_').find((run) => run.italic)?.text).toBe('tenue')
  })

  it('combina negrita e itálica con el triple delimitador', () => {
    const run = inlineMarkdownRuns('***ambas***').find((entry) => entry.italic)
    expect(run?.bold).toBe(true)
    expect(run?.italic).toBe(true)
    expect(run?.text).toBe('ambas')
  })

  it('combina negrita e itálica anidadas con delimitadores distintos', () => {
    const runs = inlineMarkdownRuns('**muy _fuerte_**')
    expect(runs.every((run) => run.bold)).toBe(true)
    expect(runs.find((run) => run.italic)?.text).toBe('fuerte')
  })

  it('deja un delimitador sin cerrar como texto literal', () => {
    const runs = inlineMarkdownRuns('un *asterisco suelto')
    expect(runs.map((run) => run.text).join('')).toBe('un *asterisco suelto')
    expect(runs.every((run) => !run.italic)).toBe(true)
  })

  it('aplana el código inline', () => {
    expect(inlineMarkdownRuns('usá `npm run ci` ahora').map((run) => run.text).join('')).toBe('usá npm run ci ahora')
  })

  it('conserva el texto del enlace y su destino', () => {
    expect(inlineMarkdownRuns('ver [la guía](https://ejemplo/x)').map((run) => run.text).join('')).toBe('ver la guía (https://ejemplo/x)')
  })

  it('no repite el destino cuando el enlace es una data URI', () => {
    expect(inlineMarkdownRuns('[foto](data:image/png;base64,AA)').map((run) => run.text).join('')).toBe('foto')
  })

  it('respeta los escapes', () => {
    const runs = inlineMarkdownRuns('literal \\*sin énfasis\\*')
    expect(runs.map((run) => run.text).join('')).toBe('literal *sin énfasis*')
    expect(runs.every((run) => !run.italic)).toBe(true)
  })

  it('reduce la imagen inline a su texto alternativo', () => {
    expect(inlineMarkdownRuns('mirá ![un gato](gato.png) acá').map((run) => run.text).join('')).toBe('mirá un gato acá')
  })
})

describe('markdownToBlocks', () => {
  it('convierte encabezados ATX de todos los niveles', () => {
    const blocks = markdownToBlocks('# Uno\n\n## Dos\n\n###### Seis')
    expect(typesOf(blocks)).toEqual(['heading', 'heading', 'heading'])
    expect((blocks[0] as Extract<Block, { type: 'heading' }>).level).toBe(1)
    expect((blocks[1] as Extract<Block, { type: 'heading' }>).level).toBe(2)
    expect((blocks[2] as Extract<Block, { type: 'heading' }>).level).toBe(6)
  })

  it('acepta encabezados Setext', () => {
    const blocks = markdownToBlocks('Título\n===\n\nSubtítulo\n---')
    expect(typesOf(blocks)).toEqual(['heading', 'heading'])
    expect((blocks[0] as Extract<Block, { type: 'heading' }>).level).toBe(1)
    expect((blocks[1] as Extract<Block, { type: 'heading' }>).level).toBe(2)
  })

  it('junta las líneas de un párrafo y separa por línea en blanco', () => {
    const blocks = markdownToBlocks('una línea\ny la siguiente\n\notro párrafo')
    expect(typesOf(blocks)).toEqual(['para', 'para'])
    expect(textOf(blocks[0])).toBe('una línea y la siguiente')
  })

  it('arma listas no ordenadas con cualquier marcador', () => {
    for (const marker of ['-', '*', '+']) {
      const list = find(markdownToBlocks(`${marker} uno\n${marker} dos`), 'list')
      expect(list.ordered).toBe(false)
      expect(list.items).toHaveLength(2)
    }
  })

  it('arma listas ordenadas', () => {
    const list = find(markdownToBlocks('1. uno\n2. dos\n3. tres'), 'list')
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(3)
  })

  it('separa una lista ordenada de una no ordenada contigua', () => {
    const blocks = markdownToBlocks('- viñeta\n1. número')
    const lists = blocks.filter((block) => block.type === 'list') as Array<Extract<Block, { type: 'list' }>>
    expect(lists).toHaveLength(2)
    expect(lists[0].ordered).toBe(false)
    expect(lists[1].ordered).toBe(true)
  })

  it('sangra los ítems anidados', () => {
    const list = find(markdownToBlocks('- padre\n  - hijo'), 'list')
    expect(list.items).toHaveLength(2)
    expect(list.items[1].map((run) => run.text).join('')).toMatch(/^\s{2,}/)
  })

  it('corta la lista cuando empieza un párrafo', () => {
    const blocks = markdownToBlocks('- uno\n- dos\n\nUn párrafo suelto.')
    expect(typesOf(blocks)).toEqual(['list', 'para'])
    expect(textOf(blocks[1])).toBe('Un párrafo suelto.')
  })

  it('arma una tabla GFM con su encabezado', () => {
    const table = find(markdownToBlocks('| Producto | Precio |\n| --- | ---: |\n| Café | 100 |\n| Té | 80 |'), 'table')
    expect(table.rows[0]).toEqual(['Producto', 'Precio'])
    expect(table.rows).toHaveLength(3)
    expect(table.rows[1]).toEqual(['Café', '100'])
  })

  it('acepta tablas sin las barras de los extremos', () => {
    const table = find(markdownToBlocks('a | b\n--- | ---\n1 | 2'), 'table')
    expect(table.rows[0]).toEqual(['a', 'b'])
    expect(table.rows[1]).toEqual(['1', '2'])
  })

  it('sin fila separadora no hay tabla, es un párrafo', () => {
    const blocks = markdownToBlocks('| a | b |\n| c | d |')
    expect(typesOf(blocks)).toEqual(['para'])
  })

  it('conserva el bloque de código cercado sin interpretarlo', () => {
    const blocks = markdownToBlocks('```ts\nconst a = **1**\n```')
    expect(typesOf(blocks)).toEqual(['para'])
    expect(textOf(blocks[0])).toContain('const a = **1**')
  })

  it('un fence sin cerrar consume hasta el final sin romperse', () => {
    const blocks = markdownToBlocks('```\nsin cierre\ny más')
    expect(typesOf(blocks)).toEqual(['para'])
    expect(textOf(blocks[0])).toContain('sin cierre')
  })

  it('conserva el bloque indentado con cuatro espacios', () => {
    const blocks = markdownToBlocks('    código indentado')
    expect(textOf(blocks[0])).toContain('código indentado')
  })

  it('marca las citas', () => {
    const blocks = markdownToBlocks('> una cita')
    expect(textOf(blocks[0])).toBe('> una cita')
  })

  it('incrusta una imagen con data URI como bloque propio', () => {
    const image = find(markdownToBlocks(`![gato](data:image/png;base64,${PNG_1x1_BASE64})`), 'image')
    expect(image.format).toBe('PNG')
    expect(image.w).toBe(1)
    expect(image.h).toBe(1)
  })

  it('ignora una imagen por URL sin romper el documento', () => {
    const blocks = markdownToBlocks('![gato](https://ejemplo/gato.png)\n\nTexto después.')
    expect(blocks.some((block) => block.type === 'image')).toBe(false)
    expect(textOf(blocks.at(-1) as Block)).toBe('Texto después.')
  })

  it('descarta el front-matter YAML', () => {
    const blocks = markdownToBlocks('---\ntitle: Algo\n---\n# Título')
    expect(typesOf(blocks)).toEqual(['heading'])
  })

  it('devuelve una lista vacía para un documento vacío', () => {
    expect(markdownToBlocks('')).toEqual([])
    expect(markdownToBlocks('\n\n   \n')).toEqual([])
  })

  it('mantiene el orden del documento', () => {
    const markdown = '# Título\n\nUn párrafo.\n\n- uno\n- dos\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(typesOf(markdownToBlocks(markdown))).toEqual(['heading', 'para', 'list', 'table'])
  })
})
