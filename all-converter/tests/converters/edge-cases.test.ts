import { describe, expect, it } from 'vitest'
describe('edge cases', () => { it('recognizes an empty file', () => expect(new File([], 'empty.png').size).toBe(0)) })
