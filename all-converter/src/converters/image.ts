import type { Converter } from './types'

export function isAnimatedRaster(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('acTL') || text.includes('ANIM')
}

export const imageConverter: Converter = {
  id: 'image-convert', label: 'Convertir imagen', from: ['image'], to: 'png|jpg|webp', maxSizeMB: 50,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (isAnimatedRaster(new Uint8Array(await file.arrayBuffer()))) throw new Error('Las imágenes PNG o WebP animadas no se pueden convertir como imagen estática.')
    try {
      onProgress({ percent: 10, stage: 'Decodificando imagen' })
      const bitmap = await createImageBitmap(file)
      const requestedWidth = Number(options.maxWidth)
      const width = requestedWidth > 0 ? Math.min(requestedWidth, bitmap.width) : bitmap.width
      const height = Math.round(bitmap.height * (width / bitmap.width))
      const canvas = new OffscreenCanvas(width, height)
      const type = String(options.mime ?? 'image/png')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No se pudo preparar la imagen para convertirla.')
      if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height) }
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type, quality: Number(options.quality ?? 0.85) })
      onProgress({ percent: 100, stage: 'Completado' })
      return [{ name: file.name.replace(/\.[^.]+$/, type === 'image/jpeg' ? '.jpg' : `.${type.split('/')[1]}`), mime: type, buffer: await blob.arrayBuffer(), sizeBytes: blob.size, previewKind: 'image' }]
    } catch (error) {
      if (error instanceof RangeError || error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('El navegador no tiene memoria suficiente. Probá con un archivo más chico.')
      throw error
    }
  },
}
