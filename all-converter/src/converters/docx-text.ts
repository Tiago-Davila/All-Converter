import type { Converter } from './types'

export const docxTextConverter: Converter = { id: 'docx-to-text', label: 'DOCX a texto o HTML', from: ['document'], to: 'txt|html', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const target = String(options.target ?? 'txt')
    onProgress({ percent: 40, stage: 'Leyendo documento' })
    let output: string
    let mime: string
    if (target === 'html') {
      const { value } = await mammoth.convertToHtml({ arrayBuffer })
      output = `<!doctype html>\n<html lang="es">\n<head><meta charset="utf-8"><title>${file.name}</title></head>\n<body>\n${value}\n</body>\n</html>\n`
      mime = 'text/html'
    } else {
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      output = value
      mime = 'text/plain'
    }
    if (!output.trim()) throw new Error('El documento no contiene texto extraíble.')
    onProgress({ percent: 100, stage: 'Completado' })
    const buffer = new TextEncoder().encode(output).buffer
    return [{ name: file.name.replace(/\.docx$/i, `.${target}`), mime, buffer, sizeBytes: buffer.byteLength }]
  }
}
