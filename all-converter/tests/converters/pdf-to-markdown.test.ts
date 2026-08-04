import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { pdfToMarkdownConverter } from '../../src/converters/pdf-to-markdown'
import { markdownToPdfConverter } from '../../src/converters/markdown-to-pdf'
import { getAvailableConverters } from '../../src/converters/registry'

const noop = () => {}
const signal = new AbortController().signal

/** Convierte Markdown a PDF y vuelve, que es la única forma de tener un PDF con estructura conocida. */
async function roundTrip(markdown: string): Promise<string> {
  const [pdf] = await markdownToPdfConverter.convert(new File([markdown], 'doc.md'), noop, {}, signal)
  const [result] = await pdfToMarkdownConverter.convert(new File([pdf.buffer as BlobPart], 'doc.pdf'), noop, {}, signal)
  return new TextDecoder().decode(result.buffer)
}

describe('PDF to Markdown converter', () => {
  it('usa el límite de PDF y declara sus limitaciones', () => {
    expect(pdfToMarkdownConverter.maxSizeMB).toBe(25)
    expect(pdfToMarkdownConverter.limitation).toMatch(/OCR/)
  })

  it('el registry lo ofrece para un PDF', () => {
    const available = getAvailableConverters({ kind: 'pdf', mime: 'application/pdf', extension: 'pdf', detection: 'magic-bytes' })
    expect(available.map((converter) => converter.id)).toContain('pdf-to-md')
  })

  it('produce un .md con el mime correcto', async () => {
    const [pdf] = await markdownToPdfConverter.convert(new File(['# Título\n\nUn párrafo.\n'], 'doc.md'), noop, {}, signal)
    const [result] = await pdfToMarkdownConverter.convert(new File([pdf.buffer as BlobPart], 'informe.pdf'), noop, {}, signal)
    expect(result.name).toBe('informe.md')
    expect(result.mime).toBe('text/markdown')
    expect(result.sizeBytes).toBeGreaterThan(0)
  })

  it('recupera los títulos como encabezados', async () => {
    const markdown = await roundTrip('# Informe de ventas\n\nEl cuerpo del documento va acá.\n')
    expect(markdown).toMatch(/^#+ .*Informe de ventas/m)
  })

  it('recupera el texto de los párrafos', async () => {
    const markdown = await roundTrip('# T\n\nUna frase que tiene que sobrevivir entera.\n')
    expect(markdown.replace(/\\/g, '')).toContain('Una frase que tiene que sobrevivir entera.')
  })

  it('recupera las tablas en formato GFM', async () => {
    const markdown = await roundTrip('| Producto | Precio |\n| --- | --- |\n| Cafe | 100 |\n| Te | 85 |\n')
    expect(markdown).toContain('Producto')
    expect(markdown).toMatch(/\| --- \|/)
  })

  it('rechaza un PDF escaneado con el mensaje de OCR', async () => {
    const file = new File([await readFile(new URL('../fixtures/scanned.pdf', import.meta.url))], 'scanned.pdf')
    await expect(pdfToMarkdownConverter.convert(file, noop, {}, signal)).rejects.toThrow(/OCR/)
  })

  it('el resultado se puede volver a parsear como Markdown', async () => {
    const { markdownToBlocks } = await import('../../src/workers/markdown-parse')
    const markdown = await roundTrip('# Informe\n\nUn párrafo cualquiera.\n')
    expect(markdownToBlocks(markdown).length).toBeGreaterThan(0)
  })
})
