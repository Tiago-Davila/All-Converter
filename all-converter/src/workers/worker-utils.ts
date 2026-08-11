import type { ConversionResult } from '../converters/types'
import type { StartRequest } from './types'

function uniqueBuffers(buffers: readonly ArrayBuffer[]): Transferable[] {
  return [...new Set(buffers)]
}

/**
 * Las entradas del ZIP llevan `Blob`, que se clona por referencia y no es transferible:
 * sólo se transfieren los `ArrayBuffer` de las demás operaciones.
 */
export function requestTransferables(request: StartRequest): Transferable[] {
  return uniqueBuffers(request.inputs.flatMap((input) => ('buffer' in input ? [input.buffer] : [])))
}

export function resultTransferables(results: readonly ConversionResult[]): Transferable[] {
  return uniqueBuffers(results.map((result) => result.buffer))
}
