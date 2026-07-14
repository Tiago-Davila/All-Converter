import type { ConversionResult } from '../converters/types'
import type { WorkerStartRequest } from './types'

function uniqueBuffers(buffers: readonly ArrayBuffer[]): Transferable[] {
  return [...new Set(buffers)]
}

export function requestTransferables(request: WorkerStartRequest): Transferable[] {
  return uniqueBuffers(request.inputs.map((input) => input.buffer))
}

export function resultTransferables(results: readonly ConversionResult[]): Transferable[] {
  return uniqueBuffers(results.map((result) => result.buffer))
}
