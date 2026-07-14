import { describe, expect, it } from 'vitest'
import { loadSheetJs } from '../../src/lib/sheetjs'
describe('SheetJS loader', () => { it('loads the local package on demand', async () => expect(await loadSheetJs()).toBeDefined()) })
