import type { Converter, DetectedFileType, FileEntry } from './types'
import { imageConverter } from './image'
import { imagesToPdfConverter } from './images-to-pdf'
import { spreadsheetConverter } from './spreadsheet'
import { spreadsheetToPdfConverter } from './spreadsheet-to-pdf'
import { pdfTextConverter, pdfToImagesConverter } from './pdf-extract'
import { pdfToDocxConverter } from './pdf-to-docx'
import { pdfToMarkdownConverter } from './pdf-to-markdown'
import { pdfMergeConverter, pdfRotateConverter, pdfSplitConverter } from './pdf-manipulate'
import { docxTextConverter } from './docx-text'
import { docxToPdfConverter } from './docx-to-pdf'
import { docxToXlsxConverter } from './docx-to-xlsx'
import { odtToPdfConverter } from './odt-to-pdf'
import { markdownToPdfConverter } from './markdown-to-pdf'
import { mp4ToMp3Converter } from './mp4-to-mp3'
import { mp3ToMp4Converter } from './mp3-to-mp4'
import { audioConverter } from './audio'

export const converters: readonly Converter[] = [imageConverter, imagesToPdfConverter, spreadsheetConverter, spreadsheetToPdfConverter, pdfTextConverter, pdfToImagesConverter, pdfToDocxConverter, pdfToMarkdownConverter, pdfMergeConverter, pdfSplitConverter, pdfRotateConverter, docxTextConverter, docxToPdfConverter, docxToXlsxConverter, odtToPdfConverter, markdownToPdfConverter, mp4ToMp3Converter, mp3ToMp4Converter, audioConverter]

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.some((source) => source.kind === type.kind && (source.mimes.includes(type.mime) || source.extensions.includes(type.extension))))
}

export function getConverterTargets(converter: Converter, type: DetectedFileType): readonly string[] {
  return converter.targetsFor?.(type) ?? converter.to.split('|')
}

export interface CommonChoice { converter: Converter; target: string }

/**
 * Devuelve los pares (converter, target) que están disponibles para TODOS los archivos del grupo.
 * Útil para el selector de formato de carpeta: solo muestra formatos que todos puedan producir.
 * Si el grupo está vacío, devuelve [].
 */
export function getCommonTargets(entries: readonly FileEntry[], registry: readonly Converter[] = converters): readonly CommonChoice[] {
  if (entries.length === 0) return []
  const choicesForEntry = (entry: FileEntry): CommonChoice[] =>
    getAvailableConverters(entry.detectedType, registry).flatMap((converter) =>
      getConverterTargets(converter, entry.detectedType).map((target) => ({ converter, target })))

  const first = choicesForEntry(entries[0])
  const rest = entries.slice(1)
  return first.filter((choice) =>
    rest.every((entry) =>
      choicesForEntry(entry).some((c) => c.converter.id === choice.converter.id && c.target === choice.target)
    )
  )
}
