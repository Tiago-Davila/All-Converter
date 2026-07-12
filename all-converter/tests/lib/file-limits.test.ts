import { describe, expect, it } from 'vitest'
import { exceedsFileLimit } from '../../src/lib/file-limits'

describe('exceedsFileLimit', () => { it('rejects a file above the converter limit', () => { expect(exceedsFileLimit(new File([new Uint8Array(2 * 1024 * 1024)], 'a.png'), { maxSizeMB: 1 })).toBe(true) }) })
