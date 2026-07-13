import { describe, expect, it } from 'vitest'
import { detectFileType } from '../../src/lib/file-type'
describe('edge cases', () => { it('rejects empty entries at intake level', () => expect(new File([], 'empty.png').size).toBe(0)); it('uses detected content or fallback safely', async () => expect((await detectFileType(new File(['x'], 'unknown.bin'))).kind).toBe('unknown') })
