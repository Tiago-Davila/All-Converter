import type { Converter } from '../converters/types'

export function exceedsFileLimit(file: File, converter: Pick<Converter, 'maxSizeMB'>): boolean {
  return file.size > converter.maxSizeMB * 1024 * 1024
}

export function fileLimitMessage(file: File, converter: Pick<Converter, 'maxSizeMB'>): string {
  return `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y supera el límite de ${converter.maxSizeMB} MB.`
}
