import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { intakeFiles, MAX_BATCH_FILES } from '../../src/lib/directory-input'

async function fixtureFile(fixture: string, name: string, relativePath?: string): Promise<{ file: File; relativePath?: string }> {
  return { file: new File([await readFile(new URL(`../fixtures/${fixture}`, import.meta.url))], name), relativePath }
}

describe('intakeFiles', () => {
  it('acepta archivos conservando la ruta relativa', async () => {
    const entries = await intakeFiles([
      await fixtureFile('sample.png', 'a.png', 'fotos/a.png'),
      await fixtureFile('sample.png', 'b.png', 'fotos/sub/b.png'),
    ])
    expect(entries.map((entry) => entry.state)).toEqual(['ready', 'ready'])
    expect(entries[1].relativePath).toBe('fotos/sub/b.png')
  })

  it('acepta formatos de origen mezclados en la misma cola (FR-023)', async () => {
    const entries = await intakeFiles([
      await fixtureFile('sample.png', 'a.png'),
      await fixtureFile('sample.csv', 'datos.csv'),
    ])
    expect(entries.map((entry) => entry.state)).toEqual(['ready', 'ready'])
    expect(entries.map((entry) => entry.detectedType.kind)).toEqual(['image', 'spreadsheet'])
  })

  it('rechaza los archivos que exceden el límite del lote', async () => {
    const incoming = await Promise.all(Array.from({ length: MAX_BATCH_FILES + 2 }, (_, index) => fixtureFile('sample.png', `foto-${index}.png`)))
    const entries = await intakeFiles(incoming)
    expect(entries.filter((entry) => entry.state === 'ready')).toHaveLength(MAX_BATCH_FILES)
    expect(entries.at(-1)?.rejectionReason).toContain('Límite de 10')
  })

  it('cuenta los archivos ya aceptados en la cola para el límite, sin mirar su formato', async () => {
    const existing = await intakeFiles([await fixtureFile('sample.csv', 'base.csv')])
    const entries = await intakeFiles([await fixtureFile('sample.png', 'a.png')], existing)
    expect(entries[0].state).toBe('ready')
  })

  it('rechaza por límite contando los ya aceptados aunque sean de otro formato', async () => {
    const existing = await intakeFiles(await Promise.all(Array.from({ length: MAX_BATCH_FILES }, (_, index) => fixtureFile('sample.png', `foto-${index}.png`))))
    const entries = await intakeFiles([await fixtureFile('sample.csv', 'datos.csv')], existing)
    expect(entries[0].state).toBe('rejected')
    expect(entries[0].rejectionReason).toContain('Límite de 10')
  })

  it('rechaza archivos vacíos y tipos no soportados con motivo', async () => {
    const empty = { file: new File([], 'vacio.png') }
    const unknown = { file: new File(['#!/bin/sh'], 'script.sh') }
    const entries = await intakeFiles([empty, unknown])
    expect(entries[0].rejectionReason).toBe('El archivo está vacío.')
    expect(entries[1].state).toBe('rejected')
    expect(entries[1].rejectionReason).toContain('Tipo no soportado')
  })
})
