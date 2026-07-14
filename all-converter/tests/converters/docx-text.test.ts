import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { docxTextConverter } from '../../src/converters/docx-text'

const noop = () => {}
const signal = new AbortController().signal
async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name)
}

describe('DOCX text converter', () => {
  it('uses the Office limit', () => expect(docxTextConverter.maxSizeMB).toBe(25))

  it('DOCX→TXT extrae el texto del documento', async () => {
    const [result] = await docxTextConverter.convert(await fixture('sample.docx'), noop, { target: 'txt' }, signal)
    expect(result.name).toBe('sample.txt')
    expect(result.mime).toBe('text/plain')
    expect(new TextDecoder().decode(result.buffer).trim().length).toBeGreaterThan(0)
  })

  it('DOCX→HTML conserva estructura de etiquetas', async () => {
    const [result] = await docxTextConverter.convert(await fixture('sample.docx'), noop, { target: 'html' }, signal)
    const html = new TextDecoder().decode(result.buffer)
    expect(result.name).toBe('sample.html')
    expect(result.mime).toBe('text/html')
    expect(html).toContain('<!doctype html>')
    expect(html).toMatch(/<(h1|h2|p|li)[ >]/)
  })
})
