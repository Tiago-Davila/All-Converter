import type { ConversionProgress } from '../converters/types'

interface PdfPageLike { getTextContent(): Promise<{ items: readonly unknown[] }> }
export interface PdfDocumentLike { numPages: number; getPage(pageNumber: number): Promise<PdfPageLike> }
export interface PdfLayoutLine { page: number; text: string; fontSize: number; x: number; y: number }
export interface PdfLayout { pages: PdfLayoutLine[][]; text: string }

function textItem(value: unknown): { str: string; transform: number[]; width: number; height: number } | undefined {
  if (typeof value !== 'object' || value === null || !('str' in value) || !('transform' in value)) return undefined
  const item = value as { str: unknown; transform: unknown; width?: unknown; height?: unknown }
  if (typeof item.str !== 'string' || !Array.isArray(item.transform) || item.transform.length < 6 || !item.transform.every((entry) => typeof entry === 'number')) return undefined
  return { str: item.str, transform: item.transform, width: typeof item.width === 'number' ? item.width : 0, height: typeof item.height === 'number' ? item.height : 0 }
}

export async function extractPdfLayout(pdf: PdfDocumentLike, onProgress?: (progress: ConversionProgress) => void): Promise<PdfLayout> {
  const pages: PdfLayoutLine[][] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent()
    const rows = new Map<number, Array<{ text: string; x: number; width: number; fontSize: number }>>()
    for (const raw of content.items) {
      const item = textItem(raw)
      if (!item?.str.trim()) continue
      const y = Math.round(item.transform[5] * 2) / 2
      const row = rows.get(y) ?? []
      row.push({ text: item.str.trim(), x: item.transform[4], width: item.width, fontSize: Math.abs(item.transform[3]) || item.height })
      rows.set(y, row)
    }
    const lines = [...rows.entries()].sort(([first], [second]) => second - first).map(([y, row]) => {
      const sorted = row.sort((first, second) => first.x - second.x)
      let text = ''
      let previousEnd: number | undefined
      for (const item of sorted) {
        const gap = previousEnd === undefined ? 0 : item.x - previousEnd
        if (text && gap > Math.max(1, item.fontSize * 0.15)) text += ' '
        text += item.text
        previousEnd = item.x + item.width
      }
      return { page: pageNumber, text, fontSize: Math.max(...sorted.map((item) => item.fontSize)), x: sorted[0].x, y }
    })
    pages.push(lines)
    onProgress?.({ percent: Math.round(pageNumber / pdf.numPages * 80), stage: `Leyendo página ${pageNumber} de ${pdf.numPages}` })
  }
  return { pages, text: pages.map((lines) => lines.map((line) => line.text).join('\n')).join('\n\n') }
}
