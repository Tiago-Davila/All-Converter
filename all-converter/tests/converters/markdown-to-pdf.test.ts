import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { markdownToPdfConverter } from '../../src/converters/markdown-to-pdf'
import { getAvailableConverters } from '../../src/converters/registry'
import { PNG_1x1_BASE64 } from '../helpers/odf'

const noop = () => {}
const signal = new AbortController().signal

async function convertMarkdown(markdown: string, name = 'doc.md') {
  const [result] = await markdownToPdfConverter.convert(new File([markdown], name), noop, {}, signal)
  return result
}

describe('Markdown to PDF converter', () => {
  it('usa el límite de documentos y declara sus limitaciones', () => {
    expect(markdownToPdfConverter.maxSizeMB).toBe(25)
    expect(markdownToPdfConverter.limitation).toMatch(/data URI/)
  })

  it('el registry lo ofrece para un .md detectado por extensión', () => {
    const available = getAvailableConverters({ kind: 'document', mime: 'text/markdown', extension: 'md', detection: 'extension' })
    expect(available.map((converter) => converter.id)).toContain('md-to-pdf')
  })

  it('también lo ofrece cuando el navegador no aporta mime', () => {
    const available = getAvailableConverters({ kind: 'document', mime: '', extension: 'markdown', detection: 'extension' })
    expect(available.map((converter) => converter.id)).toContain('md-to-pdf')
  })

  it('convierte el fixture real a un PDF válido', async () => {
    const markdown = await readFile(new URL('../fixtures/sample.md', import.meta.url), 'utf8')
    const result = await convertMarkdown(markdown, 'sample.md')
    expect(result.name).toBe('sample.pdf')
    expect(result.mime).toBe('application/pdf')
    expect(result.previewKind).toBe('pdf')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
  })

  it('conserva el contenido de las tablas del Markdown', async () => {
    const markdown = await readFile(new URL('../fixtures/sample.md', import.meta.url), 'utf8')
    const result = await convertMarkdown(markdown, 'sample.md')
    expect(Buffer.from(result.buffer).toString('latin1')).toContain('Producto')
  })

  it('incrusta una imagen escrita como data URI', async () => {
    const result = await convertMarkdown(`# Con imagen\n\n![gato](data:image/png;base64,${PNG_1x1_BASE64})\n`)
    expect(Buffer.from(result.buffer).toString('latin1')).toMatch(/\/I\d+ Do/)
  })

  it('omite una imagen por URL sin romper la conversión', async () => {
    const result = await convertMarkdown('# Con enlace\n\n![gato](https://ejemplo/gato.png)\n\nTexto.\n')
    expect(new TextDecoder().decode(result.buffer.slice(0, 5))).toBe('%PDF-')
    expect(Buffer.from(result.buffer).toString('latin1')).not.toMatch(/\/I\d+ Do/)
  })

  it('rechaza un Markdown sin contenido convertible', async () => {
    await expect(convertMarkdown('   \n\n  \n')).rejects.toThrow(/contenido/)
  })

  it('rechaza una operación con un archivo que no es Markdown', async () => {
    const { validateOfficeRequest } = await import('../../src/workers/validation')
    expect(() =>
      validateOfficeRequest({
        kind: 'start',
        jobId: 'x',
        operation: 'md-to-pdf',
        inputs: [{ name: 'hoja.xlsx', buffer: new ArrayBuffer(4), mime: 'application/vnd.ms-excel' }],
        options: {},
      }),
    ).toThrow(/Markdown/)
  })
})
