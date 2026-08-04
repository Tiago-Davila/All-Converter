import type { Converter, DetectedFileType } from './types'
import { imageConverter } from './image'
import { imagesToPdfConverter } from './images-to-pdf'
import { spreadsheetConverter } from './spreadsheet'
import { spreadsheetToPdfConverter } from './spreadsheet-to-pdf'
import { pdfTextConverter, pdfToImagesConverter } from './pdf-extract'
import { pdfToDocxConverter } from './pdf-to-docx'
import { pdfMergeConverter, pdfRotateConverter, pdfSplitConverter } from './pdf-manipulate'
import { docxTextConverter } from './docx-text'
import { docxToPdfConverter } from './docx-to-pdf'
import { docxToXlsxConverter } from './docx-to-xlsx'
import { odtToPdfConverter } from './odt-to-pdf'
import { markdownToPdfConverter } from './markdown-to-pdf'
import { mp4ToMp3Converter } from './mp4-to-mp3'
import { mp3ToMp4Converter } from './mp3-to-mp4'
import { audioConverter } from './audio'

export const converters: readonly Converter[] = [imageConverter, imagesToPdfConverter, spreadsheetConverter, spreadsheetToPdfConverter, pdfTextConverter, pdfToImagesConverter, pdfToDocxConverter, pdfMergeConverter, pdfSplitConverter, pdfRotateConverter, docxTextConverter, docxToPdfConverter, docxToXlsxConverter, odtToPdfConverter, markdownToPdfConverter, mp4ToMp3Converter, mp3ToMp4Converter, audioConverter]

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.some((source) => source.kind === type.kind && (source.mimes.includes(type.mime) || source.extensions.includes(type.extension))))
}

export function getConverterTargets(converter: Converter, type: DetectedFileType): readonly string[] {
  return converter.targetsFor?.(type) ?? converter.to.split('|')
}
