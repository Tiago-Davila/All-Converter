import type { ConversionProgress } from '../converters/types'

interface PdfCommonObjs { has(id: string): boolean; get(id: string): unknown }
interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>
  getOperatorList?(): Promise<unknown>
  commonObjs?: PdfCommonObjs
}
export interface PdfDocumentLike { numPages: number; getPage(pageNumber: number): Promise<PdfPageLike> }
/** Segmento de texto con estilo (para reconstruir negrita/itálica y columnas de tabla). */
export interface PdfLayoutSpan { text: string; x: number; xEnd: number; bold: boolean; italic: boolean }
export interface PdfLayoutLine { page: number; text: string; fontSize: number; x: number; y: number; spans?: readonly PdfLayoutSpan[] }
export interface PdfLayout { pages: PdfLayoutLine[][]; text: string }
export interface PdfLayoutOptions { richText?: boolean }

interface RawItem { str: string; transform: number[]; width: number; height: number; fontName?: string }

function textItem(value: unknown): RawItem | undefined {
  if (typeof value !== 'object' || value === null || !('str' in value) || !('transform' in value)) return undefined
  const item = value as { str: unknown; transform: unknown; width?: unknown; height?: unknown; fontName?: unknown }
  if (typeof item.str !== 'string' || !Array.isArray(item.transform) || item.transform.length < 6 || !item.transform.every((entry) => typeof entry === 'number')) return undefined
  return { str: item.str, transform: item.transform as number[], width: typeof item.width === 'number' ? item.width : 0, height: typeof item.height === 'number' ? item.height : 0, fontName: typeof item.fontName === 'string' ? item.fontName : undefined }
}

const BOLD_RE = /bold|black|heavy|semibold|demibold/i
const ITALIC_RE = /italic|oblique/i

/** Resuelve, para cada fuente usada en la página, si es negrita/itálica (mejor esfuerzo). */
async function resolveFontStyles(page: PdfPageLike, fontNames: readonly string[]): Promise<Map<string, { bold: boolean; italic: boolean }>> {
  const styles = new Map<string, { bold: boolean; italic: boolean }>()
  const objs = page.commonObjs
  if (!objs) return styles
  try { await page.getOperatorList?.() } catch { /* seguimos sin resolución de fuentes */ }
  for (const fontName of fontNames) {
    try {
      if (!objs.has(fontName)) continue
      const font = objs.get(fontName) as { name?: string; bold?: boolean; italic?: boolean } | undefined
      const name = String(font?.name ?? '')
      styles.set(fontName, { bold: font?.bold === true || BOLD_RE.test(name), italic: font?.italic === true || ITALIC_RE.test(name) })
    } catch { /* fuente no resoluble: sin estilo */ }
  }
  return styles
}

export async function extractPdfLayout(pdf: PdfDocumentLike, onProgress?: (progress: ConversionProgress) => void, options: PdfLayoutOptions = {}): Promise<PdfLayout> {
  const pages: PdfLayoutLine[][] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items.map(textItem).filter((item): item is RawItem => Boolean(item?.str.trim()))
    const fontStyles = options.richText
      ? await resolveFontStyles(page, [...new Set(items.map((item) => item.fontName).filter((name): name is string => Boolean(name)))])
      : undefined
    const rows = new Map<number, Array<{ text: string; x: number; width: number; fontSize: number; bold: boolean; italic: boolean }>>()
    for (const item of items) {
      const y = Math.round(item.transform[5] * 2) / 2
      const style = (item.fontName && fontStyles?.get(item.fontName)) || { bold: false, italic: false }
      const row = rows.get(y) ?? []
      row.push({ text: item.str.trim(), x: item.transform[4], width: item.width, fontSize: Math.abs(item.transform[3]) || item.height, bold: style.bold, italic: style.italic })
      rows.set(y, row)
    }
    const lines = [...rows.entries()].sort(([first], [second]) => second - first).map(([y, row]) => {
      const sorted = row.sort((first, second) => first.x - second.x)
      let text = ''
      let previousEnd: number | undefined
      const spans: PdfLayoutSpan[] = []
      for (const item of sorted) {
        const gap = previousEnd === undefined ? 0 : item.x - previousEnd
        if (text && gap > Math.max(1, item.fontSize * 0.15)) text += ' '
        text += item.text
        spans.push({ text: item.text, x: item.x, xEnd: item.x + item.width, bold: item.bold, italic: item.italic })
        previousEnd = item.x + item.width
      }
      const line: PdfLayoutLine = { page: pageNumber, text, fontSize: Math.max(...sorted.map((item) => item.fontSize)), x: sorted[0].x, y }
      if (options.richText) line.spans = spans
      return line
    })
    pages.push(lines)
    onProgress?.({ percent: Math.round(pageNumber / pdf.numPages * 80), stage: `Leyendo página ${pageNumber} de ${pdf.numPages}` })
  }
  return { pages, text: pages.map((lines) => lines.map((line) => line.text).join('\n')).join('\n\n') }
}
