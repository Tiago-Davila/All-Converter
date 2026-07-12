import type { Converter } from './types'

interface Block { kind: 'h1' | 'h2' | 'p' | 'li'; text: string }

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  const pattern = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  for (const match of html.matchAll(pattern)) {
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (!text) continue
    const tag = match[1].toLowerCase()
    blocks.push({ kind: tag === 'h3' ? 'h2' : (tag as Block['kind']), text })
  }
  return blocks
}

export const docxToPdfConverter: Converter = { id: 'docx-to-pdf', label: 'DOCX a PDF', from: ['document'], to: 'pdf', maxSizeMB: 25,
  limitation: 'La conversión DOCX→PDF tiene fidelidad parcial: se conservan texto y estructura, pero no el diseño, las imágenes ni las fuentes originales.',
  async convert(file, onProgress, _options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const [mammoth, { jsPDF }] = await Promise.all([import('mammoth'), import('jspdf')])
    onProgress({ percent: 30, stage: 'Leyendo documento' })
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    const blocks = htmlToBlocks(html)
    if (!blocks.length) throw new Error('El documento no contiene texto extraíble.')
    onProgress({ percent: 60, stage: 'Generando PDF' })
    const pdf = new jsPDF()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const textWidth = pdf.internal.pageSize.getWidth() - 30
    let y = 20
    for (const block of blocks) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      const size = block.kind === 'h1' ? 18 : block.kind === 'h2' ? 14 : 11
      pdf.setFontSize(size)
      pdf.setFont('helvetica', block.kind === 'h1' || block.kind === 'h2' ? 'bold' : 'normal')
      const lines: string[] = pdf.splitTextToSize(block.kind === 'li' ? `• ${block.text}` : block.text, textWidth)
      for (const line of lines) {
        if (y > pageHeight - 20) { pdf.addPage(); y = 20 }
        pdf.text(line, 15, y)
        y += size * 0.5
      }
      y += size * 0.35
    }
    const buffer = pdf.output('arraybuffer')
    onProgress({ percent: 100, stage: 'PDF creado' })
    return [{ name: file.name.replace(/\.docx$/i, '.pdf'), mime: 'application/pdf', buffer, sizeBytes: buffer.byteLength, previewKind: 'pdf' }]
  }
}
