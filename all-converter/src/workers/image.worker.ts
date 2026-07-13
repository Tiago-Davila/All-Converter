import type { ConversionResult } from '../converters/types'
import { isAnimatedRaster } from '../lib/image-format'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'

const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })

function outputExtension(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  throw new Error('El formato de imagen de salida no es compatible.')
}

function positiveOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }
  let bitmap: ImageBitmap | undefined
  try {
    if (data.operation !== 'image-convert') throw new Error(`Operación de imagen desconocida: ${data.operation}.`)
    const input = data.inputs[0]
    if (!input) throw new Error('Falta la imagen de entrada.')
    const bytes = new Uint8Array(input.buffer)
    if (isAnimatedRaster(bytes)) throw new Error('Las imágenes PNG o WebP animadas no se pueden convertir como imagen estática.')

    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 10, stage: 'Decodificando imagen' } })
    bitmap = await createImageBitmap(new Blob([bytes], { type: input.mime ?? 'application/octet-stream' }))
    const maxWidth = positiveOption(data.options.maxWidth) ?? bitmap.width
    const maxHeight = positiveOption(data.options.maxHeight) ?? bitmap.height
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo preparar la imagen para convertirla.')

    const mime = typeof data.options.mime === 'string' ? data.options.mime : 'image/png'
    if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height) }
    context.drawImage(bitmap, 0, 0, width, height)
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 70, stage: 'Codificando imagen' } })
    const quality = typeof data.options.quality === 'number' ? Math.min(1, Math.max(0.01, data.options.quality)) : 0.85
    const blob = await canvas.convertToBlob({ type: mime, quality })
    const buffer = await blob.arrayBuffer()
    const extension = outputExtension(mime)
    const results: ConversionResult[] = [{ name: input.name.replace(/\.[^.]+$/, `.${extension}`), mime, buffer, sizeBytes: buffer.byteLength, previewKind: 'image' }]
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 100, stage: 'Completado' } })
    send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results))
  } catch (error) {
    const message = error instanceof RangeError || error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'El navegador no tiene memoria suficiente. Probá con un archivo más chico.'
      : error instanceof Error ? error.message : 'No se pudo convertir la imagen.'
    send({ kind: 'error', jobId: data.jobId, message })
  } finally {
    bitmap?.close()
  }
}
