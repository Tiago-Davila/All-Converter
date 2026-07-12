import { describe, expect, it } from 'vitest'
import { getAvailableConverters } from '../../src/converters/registry'
import type { Converter } from '../../src/converters/types'

const imageConverter: Converter = { id: 'image-jpg', label: 'JPG', from: ['image'], to: 'jpg', maxSizeMB: 50, async convert() { return [] } }
describe('registry', () => { it('offers only converters for the detected type', () => { expect(getAvailableConverters({ kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' }, [imageConverter])).toEqual([imageConverter]) }) })
