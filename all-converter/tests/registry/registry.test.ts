import { describe, expect, it } from 'vitest'
import { getAvailableConverters, getCommonTargets } from '../../src/converters/registry'
import type { Converter, FileEntry } from '../../src/converters/types'

const imageConverter: Converter = { id: 'image-jpg', label: 'JPG', from: [{ kind: 'image', mimes: ['image/png'], extensions: ['png'] }], to: 'jpg', maxSizeMB: 50, async convert() { return [] } }

const makeEntry = (id: string, kind: FileEntry['detectedType']['kind'], mime: string, ext: string): FileEntry => ({
  id,
  file: new File([], `${id}.${ext}`, { type: mime }),
  name: `${id}.${ext}`,
  sizeBytes: 0,
  detectedType: { kind, mime, extension: ext, detection: 'magic-bytes' },
  state: 'ready',
})

describe('registry', () => {
  it('ofrece conversores por MIME o extensión explícita', () => {
    expect(getAvailableConverters({ kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' }, [imageConverter])).toEqual([imageConverter])
    expect(getAvailableConverters({ kind: 'image', mime: '', extension: 'png', detection: 'extension' }, [imageConverter])).toEqual([imageConverter])
  })

  it('no ofrece GIF/AVIF aunque pertenezcan a la familia image', () => {
    expect(getAvailableConverters({ kind: 'image', mime: 'image/gif', extension: 'gif', detection: 'magic-bytes' }, [imageConverter])).toEqual([])
    expect(getAvailableConverters({ kind: 'image', mime: 'image/avif', extension: 'avif', detection: 'magic-bytes' }, [imageConverter])).toEqual([])
  })
})

describe('getCommonTargets', () => {
  const conv1: Converter = { id: 'img-to-jpg', label: 'img→jpg', from: [{ kind: 'image', mimes: ['image/png', 'image/webp'], extensions: ['png', 'webp'] }], to: 'jpg|webp', maxSizeMB: 50, async convert() { return [] } }
  const conv2: Converter = { id: 'img-to-pdf', label: 'img→pdf', from: [{ kind: 'image', mimes: ['image/png'], extensions: ['png'] }], to: 'pdf', maxSizeMB: 50, async convert() { return [] } }

  it('devuelve [] para lista vacía', () => {
    expect(getCommonTargets([])).toEqual([])
  })

  it('devuelve todos los targets si hay un solo archivo', () => {
    const entry = makeEntry('a', 'image', 'image/png', 'png')
    const result = getCommonTargets([entry], [conv1])
    expect(result.map((c) => c.target)).toEqual(['jpg', 'webp'])
  })

  it('devuelve intersección cuando todos los archivos comparten targets', () => {
    const e1 = makeEntry('a', 'image', 'image/png', 'png')
    const e2 = makeEntry('b', 'image', 'image/webp', 'webp')
    // e1 puede jpg|webp, e2 puede jpg|webp → intersección = jpg|webp
    const result = getCommonTargets([e1, e2], [conv1])
    expect(result.map((c) => c.target).sort()).toEqual(['jpg', 'webp'])
  })

  it('excluye targets que solo algún archivo puede producir', () => {
    const e1 = makeEntry('a', 'image', 'image/png', 'png')   // puede jpg|webp y pdf
    const e2 = makeEntry('b', 'image', 'image/webp', 'webp') // puede jpg|webp pero NO pdf (conv2 no admite webp)
    const result = getCommonTargets([e1, e2], [conv1, conv2])
    const targets = result.map((c) => c.target).sort()
    expect(targets).toEqual(['jpg', 'webp'])
    expect(targets).not.toContain('pdf')
  })
})

