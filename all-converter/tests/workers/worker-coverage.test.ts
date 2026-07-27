import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'


describe('cobertura real de workers por dominio', () => {
  it('image.worker.ts procesa mensajes start', async () => {
    const source = await readFile(new URL('../../src/workers/image.worker.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/data\.kind\s*===\s*['"]cancel['"]/)
    expect(source).toContain('validateImageRequest(data)')
    expect(source).toContain('createImageBitmap')
  })

  it('image.worker.ts también resuelve el redimensionado (003)', async () => {
    const source = await readFile(new URL('../../src/workers/image.worker.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/data\.operation\s*===\s*['"]image-resize['"]/)
    expect(source).toContain('validateImageResizeRequest(data)')
    expect(source).toContain('convertToBlob')
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
