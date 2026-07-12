import type { Converter, DetectedFileType } from './types'

export const converters: readonly Converter[] = []

export function getAvailableConverters(type: DetectedFileType, entries: readonly Converter[] = converters): readonly Converter[] {
  return entries.filter((converter) => converter.from.includes(type.kind))
}
