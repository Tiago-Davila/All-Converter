import type { ConversionProgress, ConversionResult } from '../converters/types'

export type WorkerOptionScalar = string | number | boolean | null
export type WorkerOptionValue = WorkerOptionScalar | readonly WorkerOptionScalar[]
export type WorkerOptions = Readonly<Record<string, WorkerOptionValue | undefined>>

export interface WorkerInput {
  name: string
  buffer: ArrayBuffer
  mime?: string
  relativePath?: string
}

export interface WorkerStartRequest {
  kind: 'start'
  jobId: string
  operation: string
  inputs: WorkerInput[]
  options: WorkerOptions
}

export interface WorkerCancelRequest {
  kind: 'cancel'
  jobId: string
}

export type WorkerRequest = WorkerStartRequest | WorkerCancelRequest

export type WorkerResponse =
  | { kind: 'progress'; jobId: string; progress: ConversionProgress }
  | { kind: 'result'; jobId: string; results: ConversionResult[] }
  | { kind: 'error'; jobId: string; message: string }
