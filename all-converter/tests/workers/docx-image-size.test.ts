import { describe, expect, it } from 'vitest'
import {
  emuToMm,
  fnv1a32,
  imageFingerprint,
  namespacePrefix,
  parseRelationships,
  relationshipTargetToPath,
} from '../../src/workers/docx-image-size'

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
