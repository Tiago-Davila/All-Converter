/**
 * markdown-write: `DocumentBlock[]` → texto Markdown.
 *
 * Consume el mismo modelo que `inferDocumentBlocks` (`pdf-docx-structure.ts`) le entrega a
 * `pdf-to-docx`, así que no hay heurística nueva: la inferencia de títulos, listas y tablas
 * ya está resuelta y probada. Acá solo se serializa.
 */
import type { DocumentBlock, Run } from './pdf-docx-structure'

/**
 * Escapa lo que reintroduciría marcado al reabrir el archivo.
 *
 * La barra invertida va primero, o se escaparían las barras que agrega este mismo paso.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([`*_[\]#|<>])/g, '\\$1')
}

/** Además de los caracteres activos, hay secuencias que solo abren bloque al principio de línea. */
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(\d+)([.)])\s/, '$1$2\\$3 ').replace(/^(\s*)([-+])\s/, '$1\\$2 ')
}

/** Un run se emite con sus delimitadores; el espaciado exterior queda afuera para no romperlos. */
function runToMarkdown(run: Run): string {
  const escaped = escapeMarkdown(run.text)
  const body = escaped.trim()
  if (!body) return escaped
  const [, leading = '', , trailing = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(escaped) ?? []
  const marker = run.bold && run.italic ? '***' : run.bold ? '**' : run.italic ? '*' : ''
  return `${leading}${marker}${body}${marker}${trailing}`
}

function runsToMarkdown(runs: readonly Run[]): string {
  return runs.map(runToMarkdown).join('').replace(/\s+/g, ' ').trim()
}

/** Las celdas no pueden contener barras verticales ni saltos: romperían la tabla. */
function cellToMarkdown(cell: string): string {
  return escapeMarkdown(cell).replace(/\s*\n\s*/g, ' ').trim() || ' '
}

function tableToMarkdown(rows: readonly (readonly string[])[]): string[] {
  const columns = Math.max(...rows.map((row) => row.length))
  const pad = (row: readonly string[]) => Array.from({ length: columns }, (_, index) => cellToMarkdown(row[index] ?? ''))
  const [head, ...body] = rows
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ]
}

/** Serializa los bloques inferidos de un PDF a un documento Markdown. */
export function blocksToMarkdown(blocks: readonly DocumentBlock[]): string {
  const lines: string[] = []
  let previous: DocumentBlock['kind'] | undefined
  for (const block of blocks) {
    if (block.kind === 'table') {
      if (!block.rows.length) continue
      if (lines.length) lines.push('')
      lines.push(...tableToMarkdown(block.rows))
      previous = 'table'
      continue
    }
    if (block.kind === 'list') {
      const text = runsToMarkdown(block.runs)
      if (!text) continue
      // Las listas contiguas van pegadas; entre bloques de distinto tipo va una línea en blanco.
      if (lines.length && previous !== 'list') lines.push('')
      lines.push(`${'  '.repeat(Math.max(0, block.level))}- ${text}`)
      previous = 'list'
      continue
    }
    const text = runsToMarkdown(block.runs)
    if (!text) continue
    if (lines.length) lines.push('')
    if (block.kind === 'heading1') lines.push(`# ${text}`)
    else if (block.kind === 'heading2') lines.push(`## ${text}`)
    else lines.push(escapeLineStart(text))
    previous = block.kind
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}
