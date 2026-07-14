import { runMedia } from './media'
import { AUDIO_SOURCE } from './sources'
import type { Converter, DetectedFileType } from './types'

function sourceFormat(type: Pick<DetectedFileType, 'mime' | 'extension'>): string {
  if (type.mime === 'audio/mpeg') return 'mp3'
  if (type.mime === 'audio/wav' || type.mime === 'audio/x-wav') return 'wav'
  if (type.mime === 'audio/ogg') return 'ogg'
  if (type.mime === 'audio/mp4' || type.mime === 'audio/x-m4a') return 'm4a'
  return type.extension.toLowerCase()
}

function targets(type: DetectedFileType): readonly string[] {
  return sourceFormat(type) === 'mp3' ? ['wav', 'ogg', 'm4a'] : ['mp3']
}

export const audioConverter: Converter = {
  id: 'audio-convert', label: 'Convertir audio', from: [AUDIO_SOURCE], to: 'mp3|wav|ogg|m4a', maxSizeMB: 100, targetsFor: targets,
  async convert(file, progress, options, signal) {
    const format = String(options.format ?? 'mp3').toLowerCase()
    const source = typeof options.sourceExtension === 'string' ? options.sourceExtension.toLowerCase() : sourceFormat({ mime: file.type, extension: file.name.split('.').pop() ?? '' })
    const allowed = source === 'mp3' ? ['wav', 'ogg', 'm4a'] : ['mp3']
    if (format === source) throw new Error(`El archivo ya está en formato ${format.toUpperCase()}.`)
    if (!allowed.includes(format)) throw new Error(`La conversión ${source.toUpperCase()}→${format.toUpperCase()} no forma parte de la matriz compatible.`)
    return runMedia(file, { operation: 'audio', outputName: `${file.name.replace(/\.[^.]+$/, '')}.${format}`, outputFormat: format }, progress, signal)
  },
}
