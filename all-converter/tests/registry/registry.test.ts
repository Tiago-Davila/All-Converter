import { describe, expect, it } from 'vitest'
import { getAvailableConverters } from '../../src/converters/registry'
import type { Converter } from '../../src/converters/types'

const imageConverter: Converter = { id: 'image-jpg', label: 'JPG', from: [{ kind: 'image', mimes: ['image/png'], extensions: ['png'] }], to: 'jpg', maxSizeMB: 50, async convert() { return [] } }

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
