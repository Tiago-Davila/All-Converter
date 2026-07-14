import type { Converter } from './types'; import { runMedia } from './media'
import { MP4_SOURCE } from './sources'
export const mp4ToMp3Converter: Converter = { id: 'mp4-to-mp3', label: 'MP4 a MP3', from: [MP4_SOURCE], to: 'mp3', maxSizeMB: 250, async convert(file, progress, _options, signal) { return runMedia(file, { operation: 'extract-mp3', outputName: `${file.name.replace(/\.[^.]+$/, '')}.mp3` }, progress, signal) } }
