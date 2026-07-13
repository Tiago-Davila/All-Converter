export type FileKind = 'image' | 'pdf' | 'spreadsheet' | 'document' | 'audio' | 'video' | 'unknown'
export type QueueState = 'detecting' | 'ready' | 'queued' | 'converting' | 'completed' | 'error' | 'cancelled' | 'rejected'

export interface DetectedFileType { kind: FileKind; mime: string; extension: string; detection: 'magic-bytes' | 'extension' }
export interface FileEntry { id: string; file: File; name: string; sizeBytes: number; detectedType: DetectedFileType; state: QueueState; relativePath?: string; rejectionReason?: string }
export interface ConversionProgress { percent?: number; stage: string }
export interface ConversionResult { name: string; mime: string; buffer: ArrayBuffer; sizeBytes: number; previewKind?: 'image' | 'pdf' }
export interface ConversionJob { id: string; inputIds: string[]; converterId: string; state: QueueState; progress: ConversionProgress; resultIds: string[]; error?: string }
export interface ConverterSource { kind: Exclude<FileKind, 'unknown'>; mimes: readonly string[]; extensions: readonly string[] }
export interface Converter { id: string; label: string; from: readonly ConverterSource[]; to: string; maxSizeMB: number; limitation?: string; convert(file: File, onProgress: (progress: ConversionProgress) => void, options: Record<string, unknown>, signal: AbortSignal): Promise<ConversionResult[]> }
