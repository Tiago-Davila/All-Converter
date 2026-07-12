import type { Converter, DetectedFileType } from './types'
import { imageConverter } from './image'
import { imagesToPdfConverter } from './images-to-pdf'
import { spreadsheetConverter } from './spreadsheet'

export const converters: readonly Converter[] = [imageConverter, imagesToPdfConverter, spreadsheetConverter]

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.includes(type.kind))
}
