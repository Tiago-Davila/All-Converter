import type { ConverterSource } from './types'

export const IMAGE_SOURCE: ConverterSource = { kind: 'image', mimes: ['image/png', 'image/jpeg', 'image/webp'], extensions: ['png', 'jpg', 'jpeg', 'webp'] }
export const PDF_SOURCE: ConverterSource = { kind: 'pdf', mimes: ['application/pdf'], extensions: ['pdf'] }
export const DOCX_SOURCE: ConverterSource = { kind: 'document', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], extensions: ['docx'] }
export const ODT_SOURCE: ConverterSource = { kind: 'document', mimes: ['application/vnd.oasis.opendocument.text'], extensions: ['odt'] }
export const SPREADSHEET_SOURCE: ConverterSource = { kind: 'spreadsheet', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv', 'application/json'], extensions: ['xlsx', 'ods', 'csv', 'json'] }
export const SPREADSHEET_PDF_SOURCE: ConverterSource = { kind: 'spreadsheet', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.oasis.opendocument.spreadsheet', 'text/csv'], extensions: ['xlsx', 'ods', 'csv'] }
export const MP3_SOURCE: ConverterSource = { kind: 'audio', mimes: ['audio/mpeg'], extensions: ['mp3'] }
export const AUDIO_SOURCE: ConverterSource = { kind: 'audio', mimes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'], extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
export const MP4_SOURCE: ConverterSource = { kind: 'video', mimes: ['video/mp4'], extensions: ['mp4'] }
