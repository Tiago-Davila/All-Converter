import type { Converter } from './types'

export const imageConverter: Converter = {
  id: 'image-convert', label: 'Convertir imagen', from: ['image'], to: 'png|jpg|webp', maxSizeMB: 50,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    onProgress({ percent: 10, stage: 'Decodificando imagen' })
    const bitmap = await createImageBitmap(file); const canvas = new OffscreenCanvas(Number(options.maxWidth) || bitmap.width, Number(options.maxHeight) || bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); const type = String(options.mime ?? 'image/png'); const blob = await canvas.convertToBlob({ type, quality: Number(options.quality ?? 0.85) }); onProgress({ percent: 100, stage: 'Completado' })
    return [{ name: file.name.replace(/\.[^.]+$/, type === 'image/jpeg' ? '.jpg' : `.${type.split('/')[1]}`), mime: type, buffer: await blob.arrayBuffer(), sizeBytes: blob.size, previewKind: 'image' }]
  }
}
