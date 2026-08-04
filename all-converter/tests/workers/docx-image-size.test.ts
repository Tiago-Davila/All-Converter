import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  buildDisplayLookup,
  emuToMm,
  extractDocxImageSizes,
  fnv1a32,
  imageFingerprint,
  namespacePrefix,
  parseDocxDrawings,
  parseRelationships,
  relationshipTargetToPath,
} from '../../src/workers/docx-image-size'
import { EMU_PER_INCH, documentXml, drawing, packDocx, paragraph, pngOfSize } from '../helpers/docx'
import { imageSize } from '../../src/workers/office-doc-render'

describe('emuToMm', () => {
  it('convierte una pulgada exacta', () => {
    expect(emuToMm(914400)).toBeCloseTo(25.4, 10)
  })

  it('convierte las medidas típicas de Word', () => {
    expect(emuToMm(1828800)).toBeCloseTo(50.8, 10) // 2 in
    expect(emuToMm(457200)).toBeCloseTo(12.7, 10) // 0,5 in
  })

  it('es lineal y devuelve cero en cero', () => {
    expect(emuToMm(0)).toBe(0)
    expect(emuToMm(1828800)).toBeCloseTo(emuToMm(914400) * 2, 10)
  })
})

describe('fnv1a32 / imageFingerprint', () => {
  it('distingue contenidos distintos del mismo largo', () => {
    expect(fnv1a32(new Uint8Array([1, 2, 3]))).not.toBe(fnv1a32(new Uint8Array([3, 2, 1])))
  })

  it('es estable para el mismo contenido', () => {
    expect(imageFingerprint(new Uint8Array([9, 8, 7]))).toBe(imageFingerprint(new Uint8Array([9, 8, 7])))
  })

  it('incluye el largo, así que un prefijo no colisiona con el total', () => {
    expect(imageFingerprint(new Uint8Array([1, 2]))).not.toBe(imageFingerprint(new Uint8Array([1, 2, 0])))
  })

  it('devuelve un entero sin signo de 32 bits', () => {
    const hash = fnv1a32(new Uint8Array([255, 255, 255, 255]))
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(hash)).toBe(true)
  })
})

describe('namespacePrefix', () => {
  const uris = ['http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing']

  it('encuentra el prefijo declarado', () => {
    const xml = '<w:document xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    expect(namespacePrefix(xml, uris, 'zz')).toBe('wp')
  })

  it('resuelve un prefijo no canónico', () => {
    const xml = '<w:document xmlns:q7="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    expect(namespacePrefix(xml, uris, 'wp')).toBe('q7')
  })

  it('cae al prefijo de reserva si la URI no está declarada', () => {
    expect(namespacePrefix('<w:document>', uris, 'wp')).toBe('wp')
  })
})

describe('relationshipTargetToPath', () => {
  it('resuelve un target relativo contra word/', () => {
    expect(relationshipTargetToPath('media/image1.png')).toBe('word/media/image1.png')
  })

  it('quita la barra inicial de un target absoluto', () => {
    expect(relationshipTargetToPath('/word/media/image1.png')).toBe('word/media/image1.png')
  })
})

describe('parseRelationships', () => {
  it('mapea los rId a rutas del zip', () => {
    const xml = `<?xml version="1.0"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="…/image" Target="media/image1.png"/>
        <Relationship Id="rId2" Type="…/image" Target="/word/media/image2.jpeg"/>
      </Relationships>`
    const map = parseRelationships(xml)
    expect(map.get('rId1')).toBe('word/media/image1.png')
    expect(map.get('rId2')).toBe('word/media/image2.jpeg')
  })

  it('ignora los targets externos: no hay bytes que asociar', () => {
    const xml = '<Relationships><Relationship Id="rId9" Target="http://ejemplo/x.png" TargetMode="External"/></Relationships>'
    expect(parseRelationships(xml).has('rId9')).toBe(false)
  })
})

describe('parseDocxDrawings', () => {
  it('lee el wp:extent de un dibujo con imagen', () => {
    const xml = documentXml(drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH }))
    const drawings = parseDocxDrawings(xml)
    expect(drawings).toHaveLength(1)
    expect(drawings[0].relationshipId).toBe('rId1')
    expect(drawings[0].size.wmm).toBeCloseTo(50.8, 6)
    expect(drawings[0].size.hmm).toBeCloseTo(25.4, 6)
  })

  it('descarta el dibujo sin a:blip: un gráfico no aporta tamaño a ninguna imagen', () => {
    const xml = documentXml(drawing({ cx: 5486400, cy: 3200400 }) + drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH, cy: EMU_PER_INCH }))
    const drawings = parseDocxDrawings(xml)
    expect(drawings).toHaveLength(1)
    expect(drawings[0].relationshipId).toBe('rId1')
    expect(drawings[0].size.wmm).toBeCloseTo(25.4, 6)
  })

  it('no confunde el a:ext de pic:spPr con el wp:extent', () => {
    const xml = documentXml(drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH, cy: EMU_PER_INCH, spPrCx: EMU_PER_INCH * 9 }))
    expect(parseDocxDrawings(xml)[0].size.wmm).toBeCloseTo(25.4, 6)
  })

  it('resuelve un prefijo de namespace no canónico', () => {
    const xml = documentXml(drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH, cy: EMU_PER_INCH, prefix: 'zz' }), {
      zz: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    }).replace(/xmlns:wp="[^"]*"\s*/, '')
    const drawings = parseDocxDrawings(xml)
    expect(drawings).toHaveLength(1)
    expect(drawings[0].size.wmm).toBeCloseTo(25.4, 6)
  })

  it('lee también wp:anchor (imágenes flotantes)', () => {
    const xml = documentXml(drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH, cy: EMU_PER_INCH, anchor: true }))
    expect(parseDocxDrawings(xml)).toHaveLength(1)
  })

  it('ignora el dibujo sin wp:extent y el de EMU no positivos', () => {
    expect(parseDocxDrawings(documentXml(drawing({ relationshipId: 'rId1' })))).toHaveLength(0)
    expect(parseDocxDrawings(documentXml(drawing({ relationshipId: 'rId1', cx: 0, cy: 0 })))).toHaveLength(0)
  })

  it('ignora un extent absurdo (más de 5000 mm)', () => {
    expect(parseDocxDrawings(documentXml(drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 1000, cy: EMU_PER_INCH })))).toHaveLength(0)
  })
})

describe('buildDisplayLookup', () => {
  const a = pngOfSize(200, 100)
  const b = pngOfSize(64, 64)
  const relationships = new Map([['rId1', 'word/media/a.png'], ['rId2', 'word/media/b.png']])
  const parts = new Map([['word/media/a.png', a], ['word/media/b.png', b]])

  it('asocia cada imagen con su propio tamaño, por contenido', () => {
    const lookup = buildDisplayLookup(
      [
        { relationshipId: 'rId1', size: { wmm: 50, hmm: 25 } },
        { relationshipId: 'rId2', size: { wmm: 10, hmm: 10 } },
      ],
      relationships,
      parts,
    )
    expect(lookup(a)).toEqual({ wmm: 50, hmm: 25 })
    expect(lookup(b)).toEqual({ wmm: 10, hmm: 10 })
  })

  it('reutiliza el tamaño de una parte repetida con el mismo extent (logo)', () => {
    const lookup = buildDisplayLookup(
      [
        { relationshipId: 'rId1', size: { wmm: 20, hmm: 10 } },
        { relationshipId: 'rId1', size: { wmm: 20, hmm: 10 } },
      ],
      relationships,
      parts,
    )
    expect(lookup(a)).toEqual({ wmm: 20, hmm: 10 })
    expect(lookup(a)).toEqual({ wmm: 20, hmm: 10 })
    expect(lookup(a)).toEqual({ wmm: 20, hmm: 10 })
  })

  it('consume en orden cuando la misma parte se usa con tamaños distintos', () => {
    const lookup = buildDisplayLookup(
      [
        { relationshipId: 'rId1', size: { wmm: 20, hmm: 10 } },
        { relationshipId: 'rId1', size: { wmm: 40, hmm: 20 } },
      ],
      relationships,
      parts,
    )
    expect(lookup(a)).toEqual({ wmm: 20, hmm: 10 })
    expect(lookup(a)).toEqual({ wmm: 40, hmm: 20 })
    expect(lookup(a)).toBeUndefined()
  })

  it('devuelve undefined para una imagen que no está en el documento', () => {
    const lookup = buildDisplayLookup([{ relationshipId: 'rId1', size: { wmm: 50, hmm: 25 } }], relationships, parts)
    expect(lookup(pngOfSize(7, 7))).toBeUndefined()
  })

  it('descarta el join cuando el aspecto declarado es disparatado', () => {
    const lookup = buildDisplayLookup(
      [{ relationshipId: 'rId1', size: { wmm: 200, hmm: 1 } }],
      relationships,
      parts,
      imageSize,
    )
    expect(lookup(a)).toBeUndefined()
  })
})

describe('extractDocxImageSizes', () => {
  async function lookupOf(bytes: Uint8Array) {
    return extractDocxImageSizes(await JSZip.loadAsync(bytes))
  }

  it('recorre el paquete completo y devuelve el tamaño de la imagen', async () => {
    const image = pngOfSize(200, 100)
    const docx = await packDocx({
      body: documentXml(paragraph('Hola') + drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    const size = (await lookupOf(docx))(image)
    expect(size?.wmm).toBeCloseTo(50.8, 6)
    expect(size?.hmm).toBeCloseTo(25.4, 6)
  })

  it('un gráfico previo no le roba el tamaño a la imagen', async () => {
    const image = pngOfSize(200, 100)
    const docx = await packDocx({
      body: documentXml(drawing({ cx: 5486400, cy: 3200400 }) + drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    expect((await lookupOf(docx))(image)?.wmm).toBeCloseTo(50.8, 6)
  })

  it('una imagen descartada por el renderizador no corre el tamaño de la siguiente', async () => {
    // El EMF va primero y con otro extent: mammoth lo emite, el renderizador lo tira.
    const emf = new Uint8Array([1, 0, 0, 0, 9, 9, 9, 9])
    const png = pngOfSize(200, 100)
    const docx = await packDocx({
      body: documentXml(
        drawing({ relationshipId: 'rId1', cx: EMU_PER_INCH * 6, cy: EMU_PER_INCH * 6 }) +
          drawing({ relationshipId: 'rId2', cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH }),
      ),
      relationships: { rId1: 'media/dibujo.emf', rId2: 'media/img.png' },
      media: { 'word/media/dibujo.emf': emf, 'word/media/img.png': png },
    })
    expect((await lookupOf(docx))(png)?.wmm).toBeCloseTo(50.8, 6)
  })

  it('degrada a un lookup vacío si el paquete no trae document.xml', async () => {
    const zip = new JSZip()
    zip.file('word/otra.xml', '<x/>')
    const lookup = await extractDocxImageSizes(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' })))
    expect(lookup(pngOfSize(2, 2))).toBeUndefined()
  })

  it('degrada a un lookup vacío si ningún dibujo declara tamaño', async () => {
    const image = pngOfSize(200, 100)
    const docx = await packDocx({
      body: documentXml(drawing({ relationshipId: 'rId1' })),
      relationships: { rId1: 'media/img.png' },
      media: { 'word/media/img.png': image },
    })
    expect((await lookupOf(docx))(image)).toBeUndefined()
  })
})
