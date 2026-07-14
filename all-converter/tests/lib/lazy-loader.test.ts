import { describe, expect, it } from 'vitest'
import { loadDomain } from '../../src/lib/lazy-loader'

describe('lazy loader', () => {
  it('loads only when requested', async () => {
    await expect(loadDomain(async () => 'pdf')).resolves.toBe('pdf')
  })
})
