import { describe, expect, it } from 'vitest'
import { detectFileType } from '../../src/lib/file-type'
describe('detectFileType', () => {
  it('falls back to CSV extension', async () => { await expect(detectFileType(new File(['a,b'], 'a.csv', { type: 'text/csv' }))).resolves.toMatchObject({ kind: 'spreadsheet', detection: 'extension' }) })
  it('maps JSON files to spreadsheet conversions', async () => { await expect(detectFileType(new File(['[]'], 'datos.json', { type: 'application/json' }))).resolves.toMatchObject({ kind: 'spreadsheet', detection: 'extension' }) })
})
