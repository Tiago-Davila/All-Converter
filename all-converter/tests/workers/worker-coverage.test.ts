import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'


describe('cobertura real de workers por dominio', () => {
  it('image.worker.ts procesa mensajes start', async () => {
    const source = await readFile(new URL('../../src/workers/image.worker.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/data\.kind\s*===\s*['"]cancel['"]/)
    expect(source).toContain("data.operation !== 'image-convert'")
    expect(source).toContain('createImageBitmap')
  })

  it('office.worker.ts delega operaciones Office reales', async () => {
    const source = await readFile(new URL('../../src/workers/office.worker.ts', import.meta.url), 'utf8')
    expect(source).toContain('executeOfficeOperation')
    expect(source).toContain('data.operation')
  })

  for (const worker of ['pdf-read.worker.ts', 'pdf-write.worker.ts'] as const) {
    it(`${worker} delega operaciones PDF reales`, async () => {
      const source = await readFile(new URL(`../../src/workers/${worker}`, import.meta.url), 'utf8')
      expect(source).toContain('executePdfOperation')
      expect(source).toContain('data.operation')
    })
  }
})
