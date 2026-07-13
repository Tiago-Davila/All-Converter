import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const workers = ['image.worker.ts', 'office.worker.ts', 'pdf-read.worker.ts', 'pdf-write.worker.ts'] as const

describe('cobertura real de workers por dominio', () => {
  for (const worker of workers) {
    it.fails(`${worker} todavía no procesa mensajes start`, async () => {
      const source = await readFile(new URL(`../../src/workers/${worker}`, import.meta.url), 'utf8')
      expect(source).toMatch(/data\.kind\s*===\s*['"]start['"]/)
    })
  }
})
