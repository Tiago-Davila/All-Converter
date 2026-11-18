import { startWorker } from '../workers/client'
import type { ZipStartRequest } from '../workers/types'
export { resolveZipPaths } from './zip-paths'

export interface ZipEntry { name: string; blob: Blob; relativePath?: string }

/**
 * Destino de la escritura. `saved` significa que el usuario ya eligió dónde y el archivo se
 * escribió a disco a medida; `blob` es el camino de respaldo, para navegadores sin File
 * System Access (Firefox, Safari), donde el llamador dispara la descarga.
 */
export type ZipDelivery = { kind: 'saved' } | { kind: 'blob'; blob: Blob }

interface FilePickerOptions { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }
interface FileSystemWritable { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface FileSystemFileHandleLike { createWritable(): Promise<FileSystemWritable> }
type SaveFilePicker = (options?: FilePickerOptions) => Promise<FileSystemFileHandleLike>

function saveFilePicker(): SaveFilePicker | undefined {
  // `showSaveFilePicker` no está tipado en el lib DOM de esta versión de TS.
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker : undefined
}

/** Lanza el worker de empaquetado y entrega cada trozo a `onChunk`, en orden. */
async function runZipWorker(
  entries: readonly ZipEntry[],
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const inputs = entries.map((entry) => ({ name: entry.name, blob: entry.blob, relativePath: entry.relativePath }))

  if (import.meta.env.MODE === 'test') {
    const { streamZip } = await import('../workers/zip-operations')
    for await (const chunk of streamZip(inputs)) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      await onChunk(chunk)
    }
    return
  }

  const request: ZipStartRequest = { kind: 'start', jobId: crypto.randomUUID(), operation: 'zip-create', inputs, options: {} }
  // Los trozos se encadenan para que la escritura a disco respete el orden de emisión.
  let queue: Promise<void> = Promise.resolve()
  let failure: unknown
  await startWorker(
    new Worker(new URL('../workers/zip.worker.ts', import.meta.url), { type: 'module' }),
    request,
    signal,
    (progress) => onProgress?.(progress.percent ?? 0),
    (chunk) => { queue = queue.then(() => onChunk(chunk)).catch((error) => { failure ??= error }) },
  )
  await queue
  if (failure) throw failure
}

/**
 * Empaqueta y entrega el ZIP.
 *
 * Se llama desde el gesto del usuario (el clic en "Descargar ZIP"), no al terminar el lote:
 * `showSaveFilePicker` exige activación transitoria, y además así no se empaqueta un archivo
 * que nadie va a descargar (FR-010).
 */
export async function saveZip(
  entries: readonly ZipEntry[],
  signal = new AbortController().signal,
  onProgress?: (percent: number) => void,
): Promise<ZipDelivery> {
  const picker = saveFilePicker()

  if (picker) {
    let handle: FileSystemFileHandleLike
    try {
      handle = await picker({
        suggestedName: 'convertitodo.zip',
        types: [{ description: 'Archivo ZIP', accept: { 'application/zip': ['.zip'] } }],
      })
    } catch (error) {
      // El usuario cerró el diálogo: no es un fallo del empaquetado.
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      return deliverAsBlob(entries, signal, onProgress)
    }
    const writable = await handle.createWritable()
    try {
      await runZipWorker(entries, (chunk) => writable.write(chunk), signal, onProgress)
      await writable.close()
      return { kind: 'saved' }
    } catch (error) {
      // Un archivo a medio escribir es peor que ninguno.
      await writable.abort().catch(() => { /* el handle ya puede estar cerrado */ })
      throw error
    }
  }

  return deliverAsBlob(entries, signal, onProgress)
}

/**
 * Respaldo sin File System Access: los trozos se juntan en un único `Blob`, que el navegador
 * respalda en disco. Sigue evitando el `ArrayBuffer` intermedio que había antes.
 */
async function deliverAsBlob(
  entries: readonly ZipEntry[],
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<ZipDelivery> {
  const chunks: Uint8Array[] = []
  await runZipWorker(entries, (chunk) => { chunks.push(chunk) }, signal, onProgress)
  return { kind: 'blob', blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }) }
}

/** Empaqueta en memoria. Se conserva para los tests y para llamadas puntuales. */
export async function createZip(entries: readonly ZipEntry[], signal = new AbortController().signal): Promise<Blob> {
  const delivery = await deliverAsBlob(entries, signal)
  if (delivery.kind !== 'blob') throw new Error('El empaquetado no devolvió un archivo.')
  return delivery.blob
}
