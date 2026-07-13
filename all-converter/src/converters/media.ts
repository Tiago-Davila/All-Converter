import type { ConversionProgress, ConversionResult } from './types'
import { startWorker } from '../workers/client'
import type { WorkerInput, WorkerOptions, WorkerStartRequest } from '../workers/types'

function optionString(options: Record<string, unknown>, key: string): string {
  const value = options[key]
  if (typeof value !== 'string' || !value) throw new Error(`Falta la opción multimedia "${key}".`)
  return value
}

export async function runMedia(
  file: File,
  options: Record<string, unknown>,
  onProgress: (value: ConversionProgress) => void,
  signal: AbortSignal,
): Promise<ConversionResult[]> {
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')

  let input: ArrayBuffer
  try {
    input = await file.arrayBuffer()
  } catch {
    throw new Error('No se pudo leer el archivo multimedia. Verificá que siga disponible e intentá nuevamente.')
  }

  const inputs: WorkerInput[] = [{ name: file.name, mime: file.type || undefined, buffer: input }]
  const cover = options.cover
  if (cover instanceof ArrayBuffer) inputs.push({ name: 'cover.png', mime: 'image/png', buffer: cover })

  const workerOptions: WorkerOptions = {
    outputName: optionString(options, 'outputName'),
    generateWaveform: options.generateWaveform === true,
    outputFormat: typeof options.outputFormat === 'string' ? options.outputFormat : undefined,
  }
  const request: WorkerStartRequest = {
    kind: 'start',
    jobId: crypto.randomUUID(),
    operation: optionString(options, 'operation'),
    inputs,
    options: workerOptions,
  }
  const worker = new Worker(new URL('../workers/media.worker.ts', import.meta.url), { type: 'module' })
  return startWorker(worker, request, signal, onProgress)
}
