import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const pendingWorkers = ['office.worker.ts', 'pdf-read.worker.ts', 'pdf-write.worker.ts'] as const

describe('cobertura real de workers por dominio', () => {
  it('image.worker.ts procesa mensajes start', async () => {
    const source = await readFile(new URL('../../src/workers/image.worker.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/data\.kind\s*===\s*['"]cancel['"]/)
    expect(source).toContain("data.operation !== 'image-convert'")
    expect(source).toContain('createImageBitmap')
  })

  for (const worker of pendingWorkers) {
    it.fails(`${worker} todavía no procesa mensajes start`, async () => {
      const source = await readFile(new URL(`../../src/workers/${worker}`, import.meta.url), 'utf8')
      expect(source).toMatch(/data\.kind\s*===\s*['"]start['"]/)
    })
  }
})
