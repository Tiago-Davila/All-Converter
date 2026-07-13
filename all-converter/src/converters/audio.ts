import type { Converter } from './types'; import { runMedia } from './media'
import { AUDIO_SOURCE } from './sources'
export const audioConverter: Converter = { id: 'audio-convert', label: 'Convertir audio', from: [AUDIO_SOURCE], to: 'mp3|wav|ogg|m4a', maxSizeMB: 100, async convert(file, progress, options, signal) { const format = String(options.format ?? 'mp3'); return runMedia(file, { operation: 'audio', outputName: `${file.name.replace(/\.[^.]+$/, '')}.${format}` }, progress, signal) } }
