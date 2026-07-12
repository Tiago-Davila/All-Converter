import type { Converter, DetectedFileType } from './types'
import { imageConverter } from './image'
import { imagesToPdfConverter } from './images-to-pdf'
import { spreadsheetConverter } from './spreadsheet'
import { spreadsheetToPdfConverter } from './spreadsheet-to-pdf'

export const converters: readonly Converter[] = [imageConverter, imagesToPdfConverter, spreadsheetConverter, spreadsheetToPdfConverter]

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.includes(type.kind))
}
