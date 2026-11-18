import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '../../src/converters/types'
import { detectFileType } from '../../src/lib/file-type'
import { intakeFiles, MAX_BATCH_FILES, MAX_SCAN_FILES, readDroppedItems } from '../../src/lib/directory-input'

// Se envuelve la detección real en un espía: el comportamiento no cambia, pero se puede contar
// cuántas veces se leyeron bytes (FR-002).
vi.mock('../../src/lib/file-type', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/file-type')>()
  return { ...actual, detectFileType: vi.fn(actual.detectFileType) }
})

const detectSpy = vi.mocked(detectFileType)

beforeEach(() => { detectSpy.mockClear() })

async function fixtureFile(fixture: string, name: string, relativePath?: string): Promise<{ file: File; relativePath?: string }> {
  return { file: new File([await readFile(new URL(`../fixtures/${fixture}`, import.meta.url))], name), relativePath }
}

/** Cola ya poblada, sin pagar la detección de 200 archivos para armarla. */
function acceptedEntries(count: number): FileEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `existente-${index}`,
    file: new File(['x'], `existente-${index}.png`),
    name: `existente-${index}.png`,
    sizeBytes: 1,
    detectedType: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' },
    state: 'ready',
  } satisfies FileEntry))
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

  it('acepta el archivo 200 y rechaza el 201 (006 FR-001)', async () => {
    const one = await fixtureFile('sample.png', 'foto.png')
    const incoming = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) => ({ file: new File([one.file], `foto-${index}.png`) }))
    const entries = await intakeFiles(incoming)
    expect(entries.filter((entry) => entry.state === 'ready')).toHaveLength(MAX_BATCH_FILES)
    expect(entries[MAX_BATCH_FILES - 1].state).toBe('ready')
    expect(entries[MAX_BATCH_FILES].state).toBe('rejected')
    expect(entries[MAX_BATCH_FILES].rejectionReason).toContain(`Límite de ${MAX_BATCH_FILES}`)
  })

  it('cuenta los archivos ya aceptados en la cola para el límite, sin mirar su formato', async () => {
    const existing = await intakeFiles([await fixtureFile('sample.csv', 'base.csv')])
    const entries = await intakeFiles([await fixtureFile('sample.png', 'a.png')], existing)
    expect(entries[0].state).toBe('ready')
  })

  it('rechaza por límite contando los ya aceptados aunque sean de otro formato', async () => {
    const entries = await intakeFiles([await fixtureFile('sample.csv', 'datos.csv')], acceptedEntries(MAX_BATCH_FILES))
    expect(entries[0].state).toBe('rejected')
    expect(entries[0].rejectionReason).toContain(`Límite de ${MAX_BATCH_FILES}`)
  })

  it('no lee los bytes de los archivos que no entran por cupo (FR-002)', async () => {
    const png = await fixtureFile('sample.png', 'foto.png')
    const incoming = Array.from({ length: 50 }, (_, index) => ({ file: new File([png.file], `foto-${index}.png`) }))
    const entries = await intakeFiles(incoming, acceptedEntries(MAX_BATCH_FILES))
    expect(entries.every((entry) => entry.state === 'rejected')).toBe(true)
    expect(detectSpy).not.toHaveBeenCalled()
  })

  it('rechaza archivos vacíos y tipos no soportados con motivo', async () => {
    const empty = { file: new File([], 'vacio.png') }
    const unknown = { file: new File(['#!/bin/sh'], 'script.sh') }
    const entries = await intakeFiles([empty, unknown])
    expect(entries[0].rejectionReason).toBe('El archivo está vacío.')
    expect(entries[1].state).toBe('rejected')
    expect(entries[1].rejectionReason).toContain('Tipo no soportado')
    // El archivo vacío se descarta sin leer bytes; el desconocido sí se lee para saberlo.
    expect(detectSpy).toHaveBeenCalledTimes(1)
  })

  it('vacío y tipo no soportado no consumen cuota', async () => {
    const png = await fixtureFile('sample.png', 'foto.png')
    const entries = await intakeFiles([
      { file: new File([], 'vacio.png') },
      { file: new File(['#!/bin/sh'], 'script.sh') },
      { file: new File([png.file], 'a.png') },
      { file: new File([png.file], 'b.png') },
    ], acceptedEntries(MAX_BATCH_FILES - 2))
    expect(entries.map((entry) => entry.state)).toEqual(['rejected', 'rejected', 'ready', 'ready'])
  })
})

/** DataTransferItem falso: sólo lo que usa readDroppedItems. */
function directoryItem(name: string, children: readonly File[]): DataTransferItem {
  const fileEntries = children.map((file) => ({
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (resolve: (value: File) => void) => resolve(file),
  }))
  let served = false
  const entry = {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (resolve: (value: unknown[]) => void) => {
        // La API entrega los hijos por tandas y termina con una tanda vacía.
        resolve(served ? [] : fileEntries)
        served = true
      },
    }),
  }
  return { webkitGetAsEntry: () => entry, getAsFile: () => null } as unknown as DataTransferItem
}

describe('readDroppedItems', () => {
  it('corta la exploración en MAX_SCAN_FILES e informa cuántos ignoró (FR-003)', async () => {
    const extra = 20
    const children = Array.from({ length: MAX_SCAN_FILES + extra }, (_, index) => new File(['x'], `f-${index}.png`))
    const result = await readDroppedItems([directoryItem('gigante', children)] as unknown as DataTransferItemList)
    expect(result.files).toHaveLength(MAX_SCAN_FILES)
    expect(result.skipped).toBe(extra)
    expect(result.files[0].relativePath).toBe('gigante/f-0.png')
  })

  it('no informa ignorados cuando la carpeta entra entera', async () => {
    const children = Array.from({ length: 3 }, (_, index) => new File(['x'], `f-${index}.png`))
    const result = await readDroppedItems([directoryItem('chica', children)] as unknown as DataTransferItemList)
    expect(result.files).toHaveLength(3)
    expect(result.skipped).toBe(0)
  })
})
