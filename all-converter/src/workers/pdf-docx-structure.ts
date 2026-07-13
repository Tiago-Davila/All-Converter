import type { PdfLayoutLine } from './pdf-layout'

export type DocumentBlock =
  | { kind: 'heading1' | 'heading2' | 'paragraph'; text: string; pageBreakBefore: boolean }
  | { kind: 'list'; text: string; level: number; pageBreakBefore: boolean }

const listPattern = /^\s*(?:[-•*]|\d+[.)])\s+/
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)] ?? 11 }

export function inferDocumentBlocks(pages: readonly PdfLayoutLine[][]): DocumentBlock[] {
  const all = pages.flat(); const bodySize = median(all.map((line) => line.fontSize).filter((size) => size > 0)); const blocks: DocumentBlock[] = []
  pages.forEach((lines, pageIndex) => {
    let paragraph: PdfLayoutLine[] = []
    let pageBreakPending = pageIndex > 0
    const pageBreak = () => { const value = pageBreakPending; pageBreakPending = false; return value }
    const flush = () => { if (!paragraph.length) return; blocks.push({ kind: 'paragraph', text: paragraph.map((line) => line.text).join(' '), pageBreakBefore: pageBreak() }); paragraph = [] }
    lines.forEach((line, index) => {
      if (line.fontSize >= bodySize * 1.8) { flush(); blocks.push({ kind: 'heading1', text: line.text, pageBreakBefore: pageBreak() }); return }
      if (line.fontSize >= bodySize * 1.35) { flush(); blocks.push({ kind: 'heading2', text: line.text, pageBreakBefore: pageBreak() }); return }
      const isList = listPattern.test(line.text) && (listPattern.test(lines[index - 1]?.text ?? '') || listPattern.test(lines[index + 1]?.text ?? ''))
      if (isList) { flush(); const baseX = Math.min(...lines.filter((candidate) => listPattern.test(candidate.text)).map((candidate) => candidate.x)); blocks.push({ kind: 'list', text: line.text.replace(listPattern, ''), level: Math.max(0, Math.round((line.x - baseX) / Math.max(bodySize * 2, 1))), pageBreakBefore: pageBreak() }); return }
      const previous = paragraph.at(-1)
      const gap = previous ? previous.y - line.y : 0
      const indent = previous ? Math.abs(previous.x - line.x) : 0
      if (previous && (gap > Math.max(previous.fontSize, line.fontSize) * 1.5 || indent > bodySize * 2)) flush()
      paragraph.push(line)
    })
    flush()
  })
  return blocks
}
