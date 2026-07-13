import { SCANNED_PDF_ERROR, openPdf } from './pdf-extract'
import type { Converter } from './types'

interface Line { text: string; fontSize: number; y: number }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export const pdfToDocxConverter: Converter = { id: 'pdf-to-docx', label: 'PDF a DOCX', from: ['pdf'], to: 'docx', maxSizeMB: 25,
  async convert(file, onProgress, _options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const pdf = await openPdf(file)
    const lines: Line[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      const content = await (await pdf.getPage(pageNumber)).getTextContent()
      // Agrupa items por coordenada vertical (transform[5]) para reconstruir líneas de lectura.
      const byRow = new Map<number, { text: string[]; fontSize: number }>()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const y = Math.round(item.transform[5])
        const fontSize = Math.abs(item.transform[3]) || item.height
        const row = byRow.get(y) ?? { text: [], fontSize }
        row.text.push(item.str)
        row.fontSize = Math.max(row.fontSize, fontSize)
        byRow.set(y, row)
      }
      const rows = [...byRow.entries()].sort(([a], [b]) => b - a)
      for (const [y, row] of rows) lines.push({ text: row.text.join(' ').trim(), fontSize: row.fontSize, y })
      onProgress({ percent: Math.round((pageNumber / pdf.numPages) * 80), stage: `Leyendo página ${pageNumber} de ${pdf.numPages}` })
    }
    if (!lines.length) throw new Error(SCANNED_PDF_ERROR)
    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx')
    const bodySize = median(lines.map((line) => line.fontSize))
    const paragraphs = lines.map((line) => {
      const heading = line.fontSize >= bodySize * 1.5 ? HeadingLevel.HEADING_1 : line.fontSize >= bodySize * 1.2 ? HeadingLevel.HEADING_2 : undefined
      return new Paragraph({ heading, children: [new TextRun(line.text)] })
    })
    onProgress({ percent: 90, stage: 'Generando DOCX' })
    const blob = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }))
    const buffer = await blob.arrayBuffer()
    onProgress({ percent: 100, stage: 'DOCX creado' })
    return [{ name: file.name.replace(/\.pdf$/i, '.docx'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer, sizeBytes: buffer.byteLength }]
  }
}
