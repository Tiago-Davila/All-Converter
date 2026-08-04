import { describe, expect, it } from 'vitest'
import { odtToPdfConverter } from '../../src/converters/odt-to-pdf'
import { buildOdt } from '../helpers/odf'
import { pngOfSize } from '../helpers/docx'

const noop = () => {}
const signal = new AbortController().signal

/** Dimensiones en mm con las que el PDF dibuja cada imagen (operador `cm` del content stream). */
const MM_PER_PT = 25.4 / 72
function drawnImagesMm(buffer: ArrayBuffer): Array<{ w: number; h: number }> {
  const raw = Buffer.from(buffer).toString('latin1')
  const pattern = /\bq\s+([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm\s+\/I\d+ Do\s+Q/g
  return [...raw.matchAll(pattern)].map((match) => ({ w: parseFloat(match[1]) * MM_PER_PT, h: parseFloat(match[2]) * MM_PER_PT }))
}

describe('ODT to PDF converter', () => {
  it('usa el límite de Office y declara fidelidad parcial', () => {
    expect(odtToPdfConverter.maxSizeMB).toBe(25)
    expect(odtToPdfConverter.limitation).toMatch(/fidelidad parcial/)
  })

  it('ODT→PDF genera un PDF válido y conserva las tablas', async () => {
    const file = new File([await buildOdt()], 'informe.odt')
    const [result] = await odtToPdfConverter.convert(file, noop, {}, signal)
    expect(result.name).toBe('informe.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })

  it('dibuja la imagen con el tamaño del draw:frame, no al ancho de la página (005)', async () => {
    const body = '<text:p><draw:frame svg:width="5cm" svg:height="2.5cm"><draw:image xlink:href="Pictures/img.png"/></draw:frame></text:p>'
    const file = new File([await buildOdt(body, { 'Pictures/img.png': pngOfSize(400, 200) })], 'informe.odt')
    const [result] = await odtToPdfConverter.convert(file, noop, {}, signal)
    const [drawn] = drawnImagesMm(result.buffer)
    expect(drawn.w).toBeCloseTo(50, 2)
    expect(drawn.h).toBeCloseTo(25, 2)
  })

  it('sin svg:width cae a los píxeles intrínsecos a 96 dpi (005)', async () => {
    const body = '<text:p><draw:frame><draw:image xlink:href="Pictures/img.png"/></draw:frame></text:p>'
    const file = new File([await buildOdt(body, { 'Pictures/img.png': pngOfSize(400, 200) })], 'informe.odt')
    const [result] = await odtToPdfConverter.convert(file, noop, {}, signal)
    const [drawn] = drawnImagesMm(result.buffer)
    expect(drawn.w).toBeCloseTo((400 * 25.4) / 96, 2)
    expect(drawn.h).toBeCloseTo((200 * 25.4) / 96, 2)
  })

  it('rechaza un ODT sin content.xml', async () => {
    const bogus = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'roto.odt')
    await expect(odtToPdfConverter.convert(bogus, noop, {}, signal)).rejects.toThrow()
  })
})
