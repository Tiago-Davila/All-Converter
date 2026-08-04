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

/**
 * Dimensiones con las que el PDF dibuja cada imagen, en milímetros.
 *
 * jsPDF no comprime por defecto, así que el content stream va en texto plano y
 * `writeImageToPDF` deja `q\n<w> 0 0 <h> <x> <y> cm\n/I<n> Do\nQ` en puntos. Los números
 * salen de `hpf`, que deja un punto colgante (`144.`) y puede arrastrar error de coma
 * flotante: hay que compararlos con toBeCloseTo, nunca como texto.
 */
const MM_PER_PT = 25.4 / 72
function drawnImagesMm(buffer: ArrayBuffer): Array<{ w: number; h: number; x: number }> {
  const raw = Buffer.from(buffer).toString('latin1')
  const pattern = /\bq\s+([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s+\/I\d+ Do\s+Q/g
  return [...raw.matchAll(pattern)].map((match) => ({
    w: parseFloat(match[1]) * MM_PER_PT,
    h: parseFloat(match[2]) * MM_PER_PT,
    x: parseFloat(match[3]) * MM_PER_PT,
  }))
}

const imageBlock = (w: number, h: number, display?: { wmm: number; hmm: number }): Block => ({
  type: 'image',
  dataUri: `data:image/png;base64,${PNG_1x1_BASE64}`,
  format: 'PNG',
  w,
  h,
  ...(display ? { display } : {}),
})

describe('renderBlocksToPdf — tamaño de las imágenes', () => {
  it('respeta el tamaño de visualización del documento original', async () => {
    const result = await renderBlocksToPdf([imageBlock(1000, 500, { wmm: 50, hmm: 25 })], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    expect(image.w).toBeCloseTo(50, 3)
    expect(image.h).toBeCloseTo(25, 3)
    expect(image.x).toBeCloseTo(15, 3) // margen izquierdo
  })

  // El A4 de jsPDF mide 595.28 × 841.89 pt, o sea 210.0016 mm de ancho: el ancho útil es
  // 180.0016 mm, no 180 exactos. De ahí la precisión de 2 decimales en los topes.
  it('encoge, conservando la proporción, lo que no entra en el ancho útil', async () => {
    const result = await renderBlocksToPdf([imageBlock(10, 10, { wmm: 400, hmm: 200 })], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    expect(image.w).toBeCloseTo(180, 2)
    expect(image.h).toBeCloseTo(90, 2)
  })

  it('sin tamaño declarado usa los píxeles intrínsecos a 96 dpi', async () => {
    const result = await renderBlocksToPdf([imageBlock(100, 50)], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    expect(image.w).toBeCloseTo(26.4583, 3)
    expect(image.h).toBeCloseTo(13.2292, 3)
  })

  it('sin tamaño declarado también encoge una imagen enorme', async () => {
    const result = await renderBlocksToPdf([imageBlock(2000, 1000)], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    expect(image.w).toBeCloseTo(180, 2)
    expect(image.h).toBeCloseTo(90, 2)
  })

  it('regresión: un PNG de 1×1 no se estira al ancho de la página', async () => {
    const result = await renderBlocksToPdf([imageBlock(1, 1)], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    // Antes del arreglo medía 180 mm: todo el ancho útil de A4.
    expect(image.w).toBeLessThan(1)
    expect(image.w).toBeCloseTo(0.2646, 3)
  })

  it('nunca agranda una imagen chica para llenar la página', async () => {
    const result = await renderBlocksToPdf([imageBlock(200, 100, { wmm: 20, hmm: 10 })], 'doc')
    const [image] = drawnImagesMm(result.buffer)
    expect(image.w).toBeCloseTo(20, 3)
  })

  it('una imagen más alta que la página se encoge y se dibuja una sola vez', async () => {
    const result = await renderBlocksToPdf([imageBlock(100, 280, { wmm: 100, hmm: 280 })], 'doc')
    const images = drawnImagesMm(result.buffer)
    expect(images).toHaveLength(1)
    expect(images[0].h).toBeCloseTo(262, 0) // 297 - TOP(20) - MARGIN(15)
    expect(images[0].h).toBeLessThanOrEqual(262.001)
  })

  it('dibuja cada imagen del documento una sola vez', async () => {
    const result = await renderBlocksToPdf(
      [imageBlock(100, 50, { wmm: 30, hmm: 15 }), imageBlock(100, 50, { wmm: 60, hmm: 30 })],
      'doc',
    )
    const images = drawnImagesMm(result.buffer)
    expect(images).toHaveLength(2)
    expect(images[0].w).toBeCloseTo(30, 3)
    expect(images[1].w).toBeCloseTo(60, 3)
  })

  it('omite una imagen con dimensiones inválidas sin abortar el documento', async () => {
    const result = await renderBlocksToPdf(
      [imageBlock(0, 0), { type: 'para', runs: [{ text: 'Producto' }] }],
      'doc',
    )
    expect(drawnImagesMm(result.buffer)).toHaveLength(0)
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })
})

describe('odfContentToBlocks — tamaño de visualización', () => {
  const resolver = () => ({ type: 'image' as const, dataUri: 'data:image/png;base64,AA', format: 'PNG' as const, w: 200, h: 100 })

  it('toma svg:width/svg:height del draw:frame contenedor', () => {
    const xml = odtContent('<text:p><draw:frame svg:width="5cm" svg:height="2.5cm"><draw:image xlink:href="Pictures/x.png"/></draw:frame></text:p>')
    const image = odfContentToBlocks(xml, resolver).find((block) => block.type === 'image') as Extract<Block, { type: 'image' }>
    expect(image.display?.wmm).toBeCloseTo(50, 6)
    expect(image.display?.hmm).toBeCloseTo(25, 6)
  })

  it('deja la imagen sin tamaño si el frame no lo declara', () => {
    const xml = odtContent('<text:p><draw:frame><draw:image xlink:href="Pictures/x.png"/></draw:frame></text:p>')
    const image = odfContentToBlocks(xml, resolver).find((block) => block.type === 'image') as Extract<Block, { type: 'image' }>
    expect(image.display).toBeUndefined()
  })

  it('asigna a cada imagen el tamaño de su propio frame', () => {
    const xml = odtContent(
      '<text:p><draw:frame svg:width="2cm" svg:height="1cm"><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>' +
        '<text:p><draw:frame svg:width="8cm" svg:height="4cm"><draw:image xlink:href="Pictures/b.png"/></draw:frame></text:p>',
    )
    const images = odfContentToBlocks(xml, resolver).filter((block) => block.type === 'image') as Array<Extract<Block, { type: 'image' }>>
    expect(images).toHaveLength(2)
    expect(images[0].display?.wmm).toBeCloseTo(20, 6)
    expect(images[1].display?.wmm).toBeCloseTo(80, 6)
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
