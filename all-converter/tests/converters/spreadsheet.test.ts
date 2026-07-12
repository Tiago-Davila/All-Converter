import { describe, expect, it } from 'vitest'
import { spreadsheetConverter } from '../../src/converters/spreadsheet'
describe('spreadsheet converter', () => { it('uses the Office limit', () => expect(spreadsheetConverter.maxSizeMB).toBe(25)) })
