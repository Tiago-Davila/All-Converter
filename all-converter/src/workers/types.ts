import type { ConversionProgress, ConversionResult } from '../converters/types'

export type WorkerRequest = { kind: 'start'; jobId: string; input: ArrayBuffer; options: Record<string, unknown> } | { kind: 'cancel'; jobId: string }
export type WorkerResponse = { kind: 'progress'; jobId: string; progress: ConversionProgress } | { kind: 'result'; jobId: string; results: ConversionResult[] } | { kind: 'error'; jobId: string; message: string }
