import type { PdfLayoutLine, PdfLayoutSpan } from './pdf-layout'

export interface Run { text: string; bold: boolean; italic: boolean }
export type DocumentBlock =
  | { kind: 'heading1' | 'heading2' | 'paragraph'; runs: Run[]; pageBreakBefore: boolean }
  | { kind: 'list'; runs: Run[]; level: number; pageBreakBefore: boolean }
  | { kind: 'table'; rows: string[][]; pageBreakBefore: boolean }

const listPattern = /^\s*(?:[-•*]|\d+[.)])\s+/
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)] ?? 11 }

// ── Runs con negrita/itálica (a partir de los spans del layout) ───────────────
function fallbackSpans(line: PdfLayoutLine): readonly PdfLayoutSpan[] {
  return line.spans?.length ? line.spans : [{ text: line.text, x: line.x, xEnd: line.x, bold: false, italic: false }]
}

/** Une los spans de varias líneas en runs, fusionando los contiguos del mismo estilo. */
function runsFromLines(lines: readonly PdfLayoutLine[]): Run[] {
  const runs: Run[] = []
  lines.forEach((line, lineIndex) => {
    fallbackSpans(line).forEach((span, spanIndex) => {
      const sep = (lineIndex > 0 || spanIndex > 0) && runs.length ? ' ' : ''
      const last = runs.at(-1)
      if (last && last.bold === span.bold && last.italic === span.italic) last.text += sep + span.text
      else runs.push({ text: sep + span.text, bold: span.bold, italic: span.italic })
    })
  })
  return runs.map((run) => ({ ...run, text: run.text.replace(/\s+/g, ' ') })).filter((run) => run.text.trim())
}

function stripLeadingList(runs: Run[]): Run[] {
  if (!runs.length) return runs
  const [first, ...rest] = runs
  const stripped = { ...first, text: first.text.replace(listPattern, '') }
  return [stripped, ...rest].filter((run, index) => run.text.trim() || index > 0)
}

// ── Detección de tablas (columnas alineadas por posición x) ──────────────────
function cellsOf(line: PdfLayoutLine): { text: string; x: number }[] {
  const spans = line.spans
  if (!spans || spans.length === 0) return [{ text: line.text, x: line.x }]
  const gapThreshold = Math.max(line.fontSize * 1.8, 16)
  const cells: { text: string; x: number }[] = []
  let text = spans[0].text
  let x = spans[0].x
  let xEnd = spans[0].xEnd
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i]
    if (span.x - xEnd > gapThreshold) { cells.push({ text: text.trim(), x }); text = span.text; x = span.x; xEnd = span.xEnd }
    else { text += ' ' + span.text; xEnd = span.xEnd }
  }
  cells.push({ text: text.trim(), x })
  return cells
}

function columnsAlign(anchor: { x: number }[], row: { x: number }[], fontSize: number): boolean {
  const tolerance = Math.max(fontSize * 1.5, 12)
  return anchor.every((cell, index) => Math.abs(cell.x - row[index].x) <= tolerance)
}

/** Marca, por índice de línea, las filas que pertenecen a una tabla (≥2 filas de ≥2 columnas alineadas). */
function detectTableRows(lines: readonly PdfLayoutLine[]): (string[] | null)[] {
  const cellRows = lines.map(cellsOf)
  const flags = new Array<boolean>(lines.length).fill(false)
  let i = 0
  while (i < lines.length) {
    const columns = cellRows[i].length
    if (columns < 2) { i++; continue }
    let j = i + 1
    while (j < lines.length && cellRows[j].length === columns && columnsAlign(cellRows[i], cellRows[j], lines[i].fontSize)) j++
    if (j - i >= 2) { for (let k = i; k < j; k++) flags[k] = true; i = j } else i++
  }
  return lines.map((_, index) => (flags[index] ? cellRows[index].map((cell) => cell.text) : null))
}

// ── Inferencia de bloques ─────────────────────────────────────────────────────
export function inferDocumentBlocks(pages: readonly PdfLayoutLine[][]): DocumentBlock[] {
  const all = pages.flat()
  const bodySize = median(all.map((line) => line.fontSize).filter((size) => size > 0))
  const blocks: DocumentBlock[] = []
  pages.forEach((lines, pageIndex) => {
    const tableRows = detectTableRows(lines)
    let paragraph: PdfLayoutLine[] = []
    let pageBreakPending = pageIndex > 0
    const pageBreak = () => { const value = pageBreakPending; pageBreakPending = false; return value }
    const flush = () => { if (!paragraph.length) return; blocks.push({ kind: 'paragraph', runs: runsFromLines(paragraph), pageBreakBefore: pageBreak() }); paragraph = [] }
    let index = 0
    while (index < lines.length) {
      if (tableRows[index]) {
        flush()
        const rows: string[][] = []
        while (index < lines.length && tableRows[index]) { rows.push(tableRows[index] as string[]); index++ }
        blocks.push({ kind: 'table', rows, pageBreakBefore: pageBreak() })
        continue
      }
      const line = lines[index]
      if (line.fontSize >= bodySize * 1.8) { flush(); blocks.push({ kind: 'heading1', runs: runsFromLines([line]), pageBreakBefore: pageBreak() }); index++; continue }
      if (line.fontSize >= bodySize * 1.35) { flush(); blocks.push({ kind: 'heading2', runs: runsFromLines([line]), pageBreakBefore: pageBreak() }); index++; continue }
      const isList = listPattern.test(line.text) && (listPattern.test(lines[index - 1]?.text ?? '') || listPattern.test(lines[index + 1]?.text ?? ''))
      if (isList) {
        flush()
        const baseX = Math.min(...lines.filter((candidate) => listPattern.test(candidate.text)).map((candidate) => candidate.x))
        blocks.push({ kind: 'list', runs: stripLeadingList(runsFromLines([line])), level: Math.max(0, Math.round((line.x - baseX) / Math.max(bodySize * 2, 1))), pageBreakBefore: pageBreak() })
        index++
        continue
      }
      const previous = paragraph.at(-1)
      const gap = previous ? previous.y - line.y : 0
      const indent = previous ? Math.abs(previous.x - line.x) : 0
      if (previous && (gap > Math.max(previous.fontSize, line.fontSize) * 1.5 || indent > bodySize * 2)) flush()
      paragraph.push(line)
      index++
    }
    flush()
  })
  return blocks
}
