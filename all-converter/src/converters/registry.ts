import type { Converter, DetectedFileType } from './types'
import { imageConverter } from './image'
import { imagesToPdfConverter } from './images-to-pdf'
import { spreadsheetConverter } from './spreadsheet'
import { spreadsheetToPdfConverter } from './spreadsheet-to-pdf'
import { pdfTextConverter, pdfToImagesConverter } from './pdf-extract'
import { pdfToDocxConverter } from './pdf-to-docx'
import { pdfMergeConverter, pdfRotateConverter, pdfSplitConverter } from './pdf-manipulate'
import { docxTextConverter } from './docx-text'

export const converters: readonly Converter[] = [imageConverter, imagesToPdfConverter, spreadsheetConverter, spreadsheetToPdfConverter, pdfTextConverter, pdfToImagesConverter, pdfToDocxConverter, pdfMergeConverter, pdfSplitConverter, pdfRotateConverter, docxTextConverter]

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.includes(type.kind))
}
