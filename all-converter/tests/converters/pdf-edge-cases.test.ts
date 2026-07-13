import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { pdfTextConverter } from '../../src/converters/pdf-extract'
import { pdfToDocxConverter } from '../../src/converters/pdf-to-docx'

const signal = new AbortController().signal
const noop = () => {}

async function fixture(name: string): Promise<File> {
  return new File([await readFile(new URL(`../fixtures/${name}`, import.meta.url))], name, { type: 'application/pdf' })
}

describe('PDF problemáticos', () => {
  for (const converter of [pdfTextConverter, pdfToDocxConverter]) {
    it(`${converter.id} rechaza un PDF protegido`, async () => {
      await expect(converter.convert(await fixture('protected.pdf'), noop, {}, signal)).rejects.toThrow(/contraseña|protegido/i)
    })

    it(`${converter.id} rechaza un PDF corrupto`, async () => {
      await expect(converter.convert(await fixture('corrupt.pdf'), noop, {}, signal)).rejects.toThrow(/dañado|incompleto/i)
    })
  }
})
