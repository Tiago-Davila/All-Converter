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

/**
 * Entrada del empaquetado ZIP. Lleva `Blob` y no `ArrayBuffer` a propósito: el blob lo
 * respalda el navegador en disco, así que 200 resultados no viven en el heap. El worker
 * lee de a uno por vez (ver specs/006-lotes-grandes/contracts/zip-stream.md).
 */
export interface ZipInput {
  name: string
  blob: Blob
  relativePath?: string
}

export interface WorkerStartRequest {
  kind: 'start'
  jobId: string
  operation: string
  inputs: WorkerInput[]
  options: WorkerOptions
}

export interface ZipStartRequest {
  kind: 'start'
  jobId: string
  operation: 'zip-create'
  inputs: ZipInput[]
  options: WorkerOptions
}

export type StartRequest = WorkerStartRequest | ZipStartRequest

export interface WorkerCancelRequest {
  kind: 'cancel'
  jobId: string
}

/** Lo que reciben los workers de conversión. El de ZIP usa `ZipWorkerRequest`. */
export type WorkerRequest = WorkerStartRequest | WorkerCancelRequest
export type ZipWorkerRequest = ZipStartRequest | WorkerCancelRequest

export type WorkerResponse =
  | { kind: 'progress'; jobId: string; progress: ConversionProgress }
  | { kind: 'result'; jobId: string; results: ConversionResult[] }
  | { kind: 'error'; jobId: string; message: string }
  // Trozo del ZIP en construcción. NO resuelve el trabajo: sólo `result`, `error` o un
  // abort lo cierran. Llegan en orden de emisión.
  | { kind: 'chunk'; jobId: string; chunk: Uint8Array }
