import { describe, expect, it } from 'vitest'
import { odtToPdfConverter } from '../../src/converters/odt-to-pdf'
import { buildOdt } from '../helpers/odf'

const noop = () => {}
const signal = new AbortController().signal

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

  it('rechaza un ODT sin content.xml', async () => {
    const bogus = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'roto.odt')
    await expect(odtToPdfConverter.convert(bogus, noop, {}, signal)).rejects.toThrow()
  })
})
