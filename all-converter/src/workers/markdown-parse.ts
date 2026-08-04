/**
 * markdown-parse: Markdown → `Block[]`, el mismo modelo intermedio que ya consumen DOCX y
 * ODT, para poder componer el PDF con `renderBlocksToPdf` sin tocarlo.
 *
 * Sin dependencias: el renderizador solo sabe dibujar cinco tipos de bloque, así que la
 * cobertura extra de un parser CommonMark completo no tendría a dónde ir. Markdown se
 * analiza por líneas, que es bastante más simple que el HTML anidado que ya se parsea en
 * `office-doc-render.ts`.
 *
 * Cubre: encabezados ATX y Setext, párrafos, listas ordenadas y no ordenadas con
 * anidación, tablas GFM, citas, bloques de código cercados e indentados, énfasis, código
 * inline, enlaces e imágenes con data URI.
 */
import type { Block, Run } from './office-doc-render'
import { imageSize } from './office-doc-render'

// ── Inline ───────────────────────────────────────────────────────────────────
// Ojo con el orden dentro de la clase: `[` y `]` van escapados o la clase se cierra sola.
const ESCAPABLE_CLASS = '\\\\`*_{}\\[\\]()#+\\-.!|>~'

/** Quita las barras de escape (`\*` → `*`) una vez que el marcado ya se resolvió. */
function unescapeInline(text: string): string {
  return text.replace(new RegExp(`\\\\([${ESCAPABLE_CLASS}])`, 'g'), '$1')
}

/**
 * Patrón único de tokens inline. El orden importa: el triple delimitador va antes que el
 * doble y el doble antes que el simple, o `***x***` se leería como negrita de `*x`.
 */
const INLINE_TOKEN = new RegExp(
  [
    `\\\\[${ESCAPABLE_CLASS}]`, // escape
    '(?<be>\\*\\*\\*|___)(?=\\S)(?<beText>[\\s\\S]*?\\S)\\k<be>', // negrita + itálica
    '(?<b>\\*\\*|__)(?=\\S)(?<bText>[\\s\\S]*?\\S)\\k<b>', // negrita
    '(?<i>\\*|_)(?=\\S)(?<iText>[\\s\\S]*?\\S)\\k<i>', // itálica
    '`+(?<code>[^`]*)`+', // código inline
    '!\\[(?<alt>[^\\]]*)\\]\\([^)]*\\)', // imagen
    '\\[(?<linkText>[^\\]]*)\\]\\((?<href>[^)\\s]*)[^)]*\\)', // enlace
    '[\\s\\S]', // cualquier otro carácter
  ].join('|'),
  'g',
)

/**
 * Divide una línea en runs con negrita e itálica.
 *
 * Se recorre con un único patrón alternado, de modo que un delimitador sin cerrar queda
 * como texto literal en vez de tragarse el resto del párrafo. El código inline y los
 * enlaces se aplanan a texto: `renderBlocksToPdf` no tiene primitivas para ellos.
 *
 * No implementa el algoritmo de delimitadores de CommonMark: una anidación con el mismo
 * carácter (`**muy *fuerte***`) se resuelve parcialmente. Mezclando delimitadores
 * (`**muy _fuerte_**`) o con el triple (`***ambas***`) funciona como se espera.
 */
export function inlineMarkdownRuns(markdown: string): Run[] {
  const runs: Run[] = []
  const push = (text: string, bold: boolean, italic: boolean) => {
    if (!text) return
    const last = runs.at(-1)
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += text
    else runs.push({ text, bold, italic })
  }
  let plain = ''
  const flush = () => { push(unescapeInline(plain), false, false); plain = '' }
  const token = new RegExp(INLINE_TOKEN.source, 'g')
  let match: RegExpExecArray | null
  while ((match = token.exec(markdown))) {
    const groups = match.groups ?? {}
    if (groups.beText !== undefined) {
      flush()
      for (const run of inlineMarkdownRuns(groups.beText)) push(run.text, true, true)
    } else if (groups.bText !== undefined) {
      flush()
      for (const run of inlineMarkdownRuns(groups.bText)) push(run.text, true, !!run.italic)
    } else if (groups.iText !== undefined) {
      flush()
      for (const run of inlineMarkdownRuns(groups.iText)) push(run.text, !!run.bold, true)
    } else if (groups.code !== undefined) {
      plain += groups.code
    } else if (groups.alt !== undefined) {
      // Imagen inline: el alt es lo único representable en una corrida de texto.
      plain += groups.alt
    } else if (groups.linkText !== undefined) {
      // Enlace: se conserva el texto y, si aporta información, el destino entre paréntesis.
      const target = groups.href ?? ''
      plain += target && target !== groups.linkText && !target.startsWith('data:') ? `${groups.linkText} (${target})` : groups.linkText
    } else {
      plain += match[0]
    }
  }
  flush()
  return runs.filter((run) => run.text.length > 0)
}

// ── Imágenes ─────────────────────────────────────────────────────────────────
/**
 * Bloque imagen a partir de `![alt](data:image/png;base64,…)`.
 *
 * Solo se aceptan data URIs: una ruta o una URL exigiría salir a buscar el archivo, y no
 * hay disco al que ir ni se puede tocar la red (Principio II). Se ignora en silencio.
 */
function imageBlockFrom(dataUri: string): Extract<Block, { type: 'image' }> | undefined {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUri.trim())
  if (!match) return undefined
  try {
    const binary = atob(match[2].replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const size = imageSize(bytes)
    if (!size) return undefined
    return { type: 'image', dataUri: dataUri.trim(), format: match[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG', w: size.w, h: size.h }
  } catch {
    return undefined
  }
}

/** Una línea que es solo una imagen se vuelve un bloque propio, no un párrafo. */
function standaloneImage(line: string): Extract<Block, { type: 'image' }> | undefined {
  const match = /^!\[[^\]]*\]\(\s*(\S[\s\S]*?)\s*\)$/.exec(line.trim())
  return match ? imageBlockFrom(match[1]) : undefined
}

// ── Tablas GFM ───────────────────────────────────────────────────────────────
const DELIMITER_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => unescapeInline(cell.trim()))
}

const isTableRow = (line: string) => /(?<!\\)\|/.test(line)

// ── Listas ───────────────────────────────────────────────────────────────────
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/

// ── Documento ────────────────────────────────────────────────────────────────
const ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*(```+|~~~+)(.*)$/
const SETEXT = /^\s*(=+|-+)\s*$/
const BLOCKQUOTE = /^\s*>\s?(.*)$/

/** Convierte un documento Markdown en la lista de bloques que dibuja `renderBlocksToPdf`. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = stripFrontMatter(markdown.replace(/\r\n?/g, '\n')).split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    const runs = inlineMarkdownRuns(paragraph.join(' '))
    if (runs.length) blocks.push({ type: 'para', runs })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (!line.trim()) { flushParagraph(); continue }

    // Bloque de código cercado: se copia literal, sin reflow ni interpretación.
    const fence = FENCE.exec(line)
    if (fence) {
      flushParagraph()
      const marker = fence[1][0]
      const body: string[] = []
      index++
      while (index < lines.length && !new RegExp(`^\\s*${marker === '`' ? '```' : '~~~'}+\\s*$`).test(lines[index])) {
        body.push(lines[index])
        index++
      }
      if (body.length) blocks.push({ type: 'para', runs: body.map((text) => ({ text: `${text}\n` })) })
      continue
    }

    const heading = ATX.exec(line)
    if (heading) {
      flushParagraph()
      const runs = inlineMarkdownRuns(heading[2])
      if (runs.length) blocks.push({ type: 'heading', level: heading[1].length, runs })
      continue
    }

    // Setext: el subrayado convierte el párrafo anterior en encabezado.
    if (paragraph.length && SETEXT.test(line) && !LIST_ITEM.test(line)) {
      const runs = inlineMarkdownRuns(paragraph.join(' '))
      paragraph = []
      if (runs.length) blocks.push({ type: 'heading', level: line.trim().startsWith('=') ? 1 : 2, runs })
      continue
    }

    // Tabla GFM: encabezado + fila separadora + cuerpo.
    if (isTableRow(line) && index + 1 < lines.length && DELIMITER_ROW.test(lines[index + 1]) && isTableRow(lines[index + 1])) {
      flushParagraph()
      const rows = [tableCells(line)]
      index += 2
      while (index < lines.length && lines[index].trim() && isTableRow(lines[index])) {
        rows.push(tableCells(lines[index]))
        index++
      }
      index--
      blocks.push({ type: 'table', rows })
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item) {
      flushParagraph()
      const ordered = /\d/.test(item[2])
      const items: Run[][] = []
      let cursor = index
      while (cursor < lines.length) {
        const current = LIST_ITEM.exec(lines[cursor])
        if (current) {
          if (/\d/.test(current[2]) !== ordered) break
          // La anidación se representa con sangría, que es lo que el renderizador dibuja.
          const indent = current[1].replace(/\t/g, '  ').length
          const prefix = indent >= 2 ? '   '.repeat(Math.floor(indent / 2)) : ''
          items.push(inlineMarkdownRuns(prefix + current[3]))
          cursor++
          continue
        }
        // Una línea suelta continúa el ítem anterior; una línea en blanco no corta la lista.
        if (!lines[cursor].trim()) {
          const next = lines[cursor + 1] ?? ''
          if (!LIST_ITEM.test(next)) break
          cursor++
          continue
        }
        const last = items.at(-1)
        if (!last) break
        last.push(...inlineMarkdownRuns(` ${lines[cursor].trim()}`))
        cursor++
      }
      index = cursor - 1
      const filled = items.filter((runs) => runs.length)
      if (filled.length) blocks.push({ type: 'list', ordered, items: filled })
      continue
    }

    const quote = BLOCKQUOTE.exec(line)
    if (quote) {
      flushParagraph()
      const runs = inlineMarkdownRuns(quote[1])
      if (runs.length) blocks.push({ type: 'para', runs: [{ text: '> ' }, ...runs] })
      continue
    }

    const image = standaloneImage(line)
    if (image) { flushParagraph(); blocks.push(image); continue }

    // Bloque indentado con cuatro espacios, solo si no continúa un párrafo.
    if (/^ {4}\S/.test(line) && !paragraph.length) {
      blocks.push({ type: 'para', runs: [{ text: `${line.slice(4)}\n` }] })
      continue
    }

    paragraph.push(line.trim())
  }

  flushParagraph()
  return blocks
}

/** El front-matter YAML es metadato, no contenido: se descarta si abre el archivo. */
function stripFrontMatter(markdown: string): string {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown)
  return match ? markdown.slice(match[0].length) : markdown
}
