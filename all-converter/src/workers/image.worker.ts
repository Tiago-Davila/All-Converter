import type { ConversionResult } from '../converters/types'
import { isAnimatedRaster } from '../lib/image-format'
import { imageErrorMessage } from '../lib/image-errors'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'
import { validateImageRequest, validateImageResizeRequest } from './validation'

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

function requiredSize(value: unknown): number {
  const size = positiveOption(value)
  if (size === undefined) throw new Error('Las dimensiones pedidas no son válidas.')
  return Math.round(size)
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }
  let bitmap: ImageBitmap | undefined
  try {
    // Dos operaciones sobre el mismo canvas: 'image-convert' (001, solo achica y
    // cambia de formato) y 'image-resize' (003, dimensiones exactas, puede agrandar).
    const resizing = data.operation === 'image-resize'
    if (resizing) validateImageResizeRequest(data)
    else validateImageRequest(data)
    const input = data.inputs[0]
    if (!input) throw new Error('Falta la imagen de entrada.')
    const bytes = new Uint8Array(input.buffer)
    // Al convertir, las animadas se rechazan; al redimensionar se usa el primer
    // fotograma y la página lo avisa (003 FR-012).
    if (!resizing && isAnimatedRaster(bytes)) throw new Error('Las imágenes PNG o WebP animadas no se pueden convertir como imagen estática.')

    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 10, stage: 'Decodificando imagen' } })
    bitmap = await createImageBitmap(new Blob([bytes], { type: input.mime ?? 'application/octet-stream' }))

    let width: number
    let height: number
    if (resizing) {
      width = requiredSize(data.options.width)
      height = requiredSize(data.options.height)
    } else {
      const maxWidth = positiveOption(data.options.maxWidth) ?? bitmap.width
      const maxHeight = positiveOption(data.options.maxHeight) ?? bitmap.height
      const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height)
      width = Math.max(1, Math.round(bitmap.width * scale))
      height = Math.max(1, Math.round(bitmap.height * scale))
    }

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
    // El redimensionador deja las dimensiones en el nombre (003 FR-013).
    const name = resizing
      ? `${input.name.replace(/\.[^.]+$/, '')}-${width}x${height}.${extension}`
      : input.name.replace(/\.[^.]+$/, `.${extension}`)
    const results: ConversionResult[] = [{ name, mime, buffer, sizeBytes: buffer.byteLength, previewKind: 'image' }]
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 100, stage: 'Completado' } })
    send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results))
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: imageErrorMessage(error) })
  } finally {
    bitmap?.close()
  }
}
