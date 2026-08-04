import { describe, it, expect } from 'vitest'
import {
  htmlToBlocks,
  inlineRuns,
  imageSize,
  odfContentToBlocks,
  odfLengthToMm,
  renderBlocksToPdf,
  type Block,
} from '../../src/workers/office-doc-render'
import { odtContent, PNG_1x1_BASE64, pngBytes } from '../helpers/odf'

const tableBlock = (blocks: Block[]) => blocks.find((block) => block.type === 'table') as Extract<Block, { type: 'table' }>
const listBlock = (blocks: Block[]) => blocks.find((block) => block.type === 'list') as Extract<Block, { type: 'list' }>

describe('htmlToBlocks (mammoth)', () => {
  it('conserva encabezado, párrafo, lista y tabla en orden', () => {
    const html =
      '<h1>Título</h1><p>Hola <strong>mundo</strong></p><ol><li>a</li><li>b</li></ol>' +
      '<table><tr><th>Producto</th><th>Precio</th></tr><tr><td>Café</td><td>100</td></tr></table>'
    const blocks = htmlToBlocks(html)
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'para', 'list', 'table'])
    expect(tableBlock(blocks).rows[0]).toContain('Producto')
    expect(listBlock(blocks).ordered).toBe(true)
    expect(listBlock(blocks).items).toHaveLength(2)
  })

  it('marca runs en negrita e itálica', () => {
    const runs = inlineRuns('normal <strong>fuerte</strong> <em>tenue</em>')
    expect(runs.find((run) => run.text.includes('fuerte'))?.bold).toBe(true)
    expect(runs.find((run) => run.text.includes('tenue'))?.italic).toBe(true)
  })

  it('captura imágenes PNG incrustadas dentro de un párrafo (como mammoth)', () => {
    const blocks = htmlToBlocks(`<p><img src="data:image/png;base64,${PNG_1x1_BASE64}"></p>`)
    const image = blocks.find((block) => block.type === 'image') as Extract<Block, { type: 'image' }>
    expect(image).toBeTruthy()
    expect(image.format).toBe('PNG')
    expect(image.w).toBe(1)
    expect(image.h).toBe(1)
  })
})

describe('imageSize', () => {
  it('lee dimensiones de PNG', () => {
    expect(imageSize(pngBytes())).toEqual({ w: 1, h: 1 })
  })
  it('lee dimensiones de JPEG (marcador SOF0)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ w: 32, h: 16 })
  })
  it('devuelve undefined para bytes desconocidos', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]))).toBeUndefined()
  })
})

describe('odfLengthToMm', () => {
  it('convierte todas las unidades que usa ODF', () => {
    expect(odfLengthToMm('43mm')).toBeCloseTo(43, 10)
    expect(odfLengthToMm('5.291cm')).toBeCloseTo(52.91, 10)
    expect(odfLengthToMm('2in')).toBeCloseTo(50.8, 10)
    expect(odfLengthToMm('150pt')).toBeCloseTo(52.9167, 3)
    expect(odfLengthToMm('96px')).toBeCloseTo(25.4, 10)
    expect(odfLengthToMm('1pc')).toBeCloseTo(4.2333, 3)
  })

  it('tolera espacios y mayúsculas', () => {
    expect(odfLengthToMm(' 2IN ')).toBeCloseTo(50.8, 10)
  })

  it('rechaza lo que no es una longitud positiva con unidad', () => {
    for (const value of ['abc', '12', '', '0cm', '-3cm', undefined]) {
      expect(odfLengthToMm(value)).toBeUndefined()
    }
  })
})

describe('odfContentToBlocks (ODT)', () => {
  it('parsea encabezado, negrita por estilo, lista y tabla', () => {
    const xml = odtContent(
      '<text:h text:outline-level="2">Informe</text:h>' +
        '<text:p>base <text:span text:style-name="T1">fuerte</text:span></text:p>' +
        '<text:list><text:list-item><text:p>a</text:p></text:list-item></text:list>' +
        '<table:table><table:table-row><table:table-cell><text:p>Producto</text:p></table:table-cell></table:table-row></table:table>',
    )
    const blocks = odfContentToBlocks(xml)
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'para', 'list', 'table'])
    const heading = blocks[0] as Extract<Block, { type: 'heading' }>
    expect(heading.level).toBe(2)
    const para = blocks[1] as Extract<Block, { type: 'para' }>
    expect(para.runs.find((run) => run.text.includes('fuerte'))?.bold).toBe(true)
    expect(tableBlock(blocks).rows[0]).toContain('Producto')
  })

  it('resuelve imágenes vía el resolver del zip', () => {
    const xml = odtContent('<text:p><draw:frame><draw:image xlink:href="Pictures/x.png"/></draw:frame></text:p>')
    const blocks = odfContentToBlocks(xml, () => ({ type: 'image', dataUri: 'data:image/png;base64,AA', format: 'PNG', w: 4, h: 2 }))
    expect(blocks.some((block) => block.type === 'image')).toBe(true)
  })
})

describe('renderBlocksToPdf', () => {
  it('produce un PDF válido con todos los tipos de bloque', async () => {
    const blocks: Block[] = [
      { type: 'heading', level: 1, runs: [{ text: 'Título' }] },
      { type: 'para', runs: [{ text: 'Texto ' }, { text: 'fuerte', bold: true }, { text: ' e ' }, { text: 'itálico', italic: true }] },
      { type: 'list', ordered: false, items: [[{ text: 'uno' }], [{ text: 'dos' }]] },
      { type: 'list', ordered: true, items: [[{ text: 'a' }], [{ text: 'b' }]] },
      { type: 'table', rows: [['Producto', 'Precio'], ['Café', '100']] },
      { type: 'image', dataUri: `data:image/png;base64,${PNG_1x1_BASE64}`, format: 'PNG', w: 1, h: 1 },
    ]
    const result = await renderBlocksToPdf(blocks, 'doc')
    expect(result.name).toBe('doc.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })

  it('rechaza documentos sin bloques', async () => {
    await expect(renderBlocksToPdf([], 'x')).rejects.toThrow(/contenido/)
  })
})
