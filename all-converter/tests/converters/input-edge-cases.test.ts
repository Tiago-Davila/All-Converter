import { describe, expect, it } from 'vitest'
import { isAnimatedRaster } from '../../src/lib/image-format'
import { spreadsheetConverter } from '../../src/converters/spreadsheet'

describe('casos borde de conversión', () => {
  it('detecta las cabeceras de PNG y WebP animados', () => {
    expect(isAnimatedRaster(new TextEncoder().encode('PNG acTL'))).toBe(true)
    expect(isAnimatedRaster(new TextEncoder().encode('RIFF WEBP ANIM'))).toBe(true)
    expect(isAnimatedRaster(new TextEncoder().encode('PNG IHDR'))).toBe(false)
  })

  it('rechaza CSV sin columnas consistentes con un mensaje accionable', async () => {
    const file = new File(['uno,dos\ntres\ncuatro,cinco,seis'], 'roto.csv', { type: 'text/csv' })
    await expect(spreadsheetConverter.convert(file, () => {}, { target: 'xlsx' }, new AbortController().signal)).rejects.toThrow(/columnas consistentes/i)
  })
})
