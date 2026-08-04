/**
 * office-doc-render: modelo de bloques compartido + renderizador a PDF para
 * documentos de texto (DOCX vía mammoth-HTML y ODT vía content.xml de ODF).
 *
 * Los Web Workers no tienen DOM, así que el HTML/XML se parsea con expresiones
 * regulares (mismo enfoque que el resto de office-operations). El renderizador
 * usa jsPDF + jspdf-autotable (ya dependencias) e intercala texto, listas,
 * tablas e imágenes en orden de documento.
 */
import type { ConversionResult } from '../converters/types'

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
}

/**
 * Tamaño con el que el documento original muestra una imagen, en milímetros.
 * Su ausencia significa "usá los píxeles intrínsecos a 96 dpi" (spec 005, FR-002).
 */
export interface DisplaySize {
  wmm: number
  hmm: number
}

export type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'para'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; dataUri: string; format: 'PNG' | 'JPEG'; w: number; h: number }

// ── Texto ──────────────────────────────────────────────────────────────────
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** Aplana HTML/XML a texto plano (para celdas de tabla). */
export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// ── Parser de HTML de mammoth ────────────────────────────────────────────────
/** Divide el HTML de un bloque en runs, marcando negrita (<strong>/<b>) e itálica (<em>/<i>). */
export function inlineRuns(html: string): Run[] {
  const runs: Run[] = []
  let bold = 0
  let italic = 0
  const token = /<(\/?)(strong|b|em|i)\b[^>]*>|<br\s*\/?>|<[^>]+>|([^<]+)/gi
  let match: RegExpExecArray | null
  while ((match = token.exec(html))) {
    if (match[2]) {
      const closing = match[1] === '/'
      const isBold = match[2].toLowerCase() === 'strong' || match[2].toLowerCase() === 'b'
      if (isBold) bold += closing ? -1 : 1
      else italic += closing ? -1 : 1
    } else if (/^<br/i.test(match[0])) {
      runs.push({ text: '\n' })
    } else if (match[3]) {
      const text = decodeEntities(match[3]).replace(/\s+/g, ' ')
      if (text) runs.push({ text, bold: bold > 0, italic: italic > 0 })
    }
  }
  return runs
}

export function parseHtmlTableRows(tableInner: string): string[][] {
  return [...tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])))
    .filter((row) => row.length > 0)
}

/** Milímetros por unidad de longitud de ODF (`svg:width="5.291cm"`). */
const ODF_UNITS: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 }

/** Convierte una longitud de ODF a milímetros. Sin unidad, cero o negativa → `undefined`. */
export function odfLengthToMm(value: string | undefined): number | undefined {
  const match = /^\s*([+-]?\d*\.?\d+)\s*(mm|cm|in|pt|pc|px)\s*$/i.exec(value ?? '')
  if (!match) return undefined
  const mm = Number(match[1]) * ODF_UNITS[match[2].toLowerCase()]
  return Number.isFinite(mm) && mm > 0 ? mm : undefined
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Lee el tamaño intrínseco de PNG (IHDR) o JPEG (marcadores SOF) sin depender del DOM. */
export function imageSize(bytes: Uint8Array): { w: number; h: number } | undefined {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
    const h = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
    if (w && h) return { w, h }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6]
        const w = (bytes[i + 7] << 8) | bytes[i + 8]
        if (w && h) return { w, h }
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (len <= 0) break
      i += 2 + len
    }
  }
  return undefined
}

function imageBlockFromDataUri(dataUri: string): Extract<Block, { type: 'image' }> | undefined {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUri)
  if (!match) return undefined
  const size = imageSize(base64ToBytes(match[2]))
  if (!size) return undefined
  return { type: 'image', dataUri, format: match[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG', w: size.w, h: size.h }
}

/** Extrae bloques imagen de un fragmento HTML (mammoth ancla imágenes dentro de <p>). */
function imagesIn(html: string): Array<Extract<Block, { type: 'image' }>> {
  const images: Array<Extract<Block, { type: 'image' }>> = []
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*"([^"]+)"/i.exec(tag[0])?.[1] ?? /\ssrc\s*=\s*'([^']+)'/i.exec(tag[0])?.[1]
    const image = src ? imageBlockFromDataUri(src) : undefined
    if (image) images.push(image)
  }
  return images
}

/** Convierte el HTML de mammoth en una lista ordenada de bloques. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  const re =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<table\b[^>]*>([\s\S]*?)<\/table>|<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    if (match[1]) {
      const runs = inlineRuns(match[2])
      if (runs.length) blocks.push({ type: 'heading', level: Number(match[1]), runs })
    } else if (match[3] !== undefined) {
      for (const image of imagesIn(match[3])) blocks.push(image)
      const runs = inlineRuns(match[3])
      if (runs.length) blocks.push({ type: 'para', runs })
    } else if (match[4]) {
      const ordered = match[4].toLowerCase() === 'ol'
      const items = [...match[5].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((li) => inlineRuns(li[1]))
        .filter((runs) => runs.length > 0)
      if (items.length) blocks.push({ type: 'list', ordered, items })
    } else if (match[6] !== undefined) {
      const rows = parseHtmlTableRows(match[6])
      if (rows.length) blocks.push({ type: 'table', rows })
    } else {
      for (const image of imagesIn(match[0])) blocks.push(image)
    }
  }
  return blocks
}

// ── Parser de ODF (content.xml de ODT) ───────────────────────────────────────
type OdfStyle = { bold?: boolean; italic?: boolean }

/** Mapea los estilos automáticos de texto (T1, T2…) a negrita/itálica. */
function parseOdfTextStyles(xml: string): Map<string, OdfStyle> {
  const styles = new Map<string, OdfStyle>()
  for (const style of xml.matchAll(/<style:style\b[^>]*style:name="([^"]+)"[^>]*>([\s\S]*?)<\/style:style>/gi)) {
    const props = /<style:text-properties\b([^>]*)>/i.exec(style[2])?.[1] ?? ''
    const bold = /fo:font-weight="(bold|[6-9]00)"/i.test(props)
    const italic = /fo:font-style="(italic|oblique)"/i.test(props)
    if (bold || italic) styles.set(style[1], { bold, italic })
  }
  return styles
}

/** Runs de un <text:p>/<text:h> de ODF, resolviendo negrita/itálica por estilo de span. */
function odfRuns(xml: string, styles: Map<string, OdfStyle>): Run[] {
  const runs: Run[] = []
  const stack: OdfStyle[] = []
  const current = (): OdfStyle => ({
    bold: stack.some((entry) => entry.bold),
    italic: stack.some((entry) => entry.italic),
  })
  const token =
    /<text:span\b[^>]*>|<\/text:span>|<text:s\b[^>]*\/?>|<text:tab\b[^>]*\/?>|<text:line-break\b[^>]*\/?>|<[^>]+>|([^<]+)/gi
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    const raw = match[0]
    if (/^<text:span\b/i.test(raw)) {
      const styleName = /text:style-name="([^"]*)"/i.exec(raw)?.[1] ?? ''
      stack.push(styles.get(styleName) ?? {})
    } else if (/^<\/text:span/i.test(raw)) {
      stack.pop()
    } else if (/^<text:s\b/i.test(raw)) {
      runs.push({ text: ' ' })
    } else if (/^<text:tab\b/i.test(raw)) {
      runs.push({ text: '  ' })
    } else if (/^<text:line-break\b/i.test(raw)) {
      runs.push({ text: '\n' })
    } else if (match[1]) {
      const text = decodeEntities(match[1]).replace(/\s+/g, ' ')
      if (text) runs.push({ text, ...current() })
    }
  }
  return runs
}

function parseOdfTable(inner: string): string[][] {
  return [...inner.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/gi)]
    .map((row) => [...row[1].matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/gi)].map((cell) => cellText(cell[1])))
    .filter((row) => row.length > 0)
}

export type OdfImageResolver = (href: string) => Extract<Block, { type: 'image' }> | undefined

/** Convierte el content.xml de un ODT en bloques. `resolveImage` lee Pictures/* del zip. */
export function odfContentToBlocks(contentXml: string, resolveImage?: OdfImageResolver): Block[] {
  const styles = parseOdfTextStyles(contentXml)
  const body = /<office:body\b[^>]*>([\s\S]*?)<\/office:body>/i.exec(contentXml)?.[1] ?? contentXml
  const blocks: Block[] = []
  const re =
    /<text:h\b([^>]*)>([\s\S]*?)<\/text:h>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:list\b[^>]*>([\s\S]*?)<\/text:list>|<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    if (match[1] !== undefined && match[2] !== undefined) {
      const level = Number(/text:outline-level="(\d+)"/i.exec(match[1])?.[1] ?? '1')
      const runs = odfRuns(match[2], styles)
      if (runs.length) blocks.push({ type: 'heading', level: Math.min(6, Math.max(1, level)), runs })
    } else if (match[3] !== undefined) {
      for (const image of resolveImage ? odfImages(match[3], resolveImage) : []) blocks.push(image)
      const runs = odfRuns(match[3], styles)
      if (runs.length) blocks.push({ type: 'para', runs })
    } else if (match[4] !== undefined) {
      const items = [...match[4].matchAll(/<text:list-item\b[^>]*>([\s\S]*?)<\/text:list-item>/gi)]
        .map((item) => odfRuns(item[1], styles))
        .filter((runs) => runs.length > 0)
      if (items.length) blocks.push({ type: 'list', ordered: false, items })
    } else if (match[5] !== undefined) {
      const rows = parseOdfTable(match[5])
      if (rows.length) blocks.push({ type: 'table', rows })
    }
  }
  return blocks
}

function* odfImages(xml: string, resolveImage: OdfImageResolver): Generator<Extract<Block, { type: 'image' }>> {
  for (const image of xml.matchAll(/<draw:image\b[^>]*xlink:href="([^"]+)"[^>]*\/?>/gi)) {
    const block = resolveImage(image[1])
    if (block) yield block
  }
}

/** Crea un bloque imagen a partir de bytes crudos (para el resolver de ODT). */
export function imageBlockFromBytes(bytes: Uint8Array, href: string): Extract<Block, { type: 'image' }> | undefined {
  const size = imageSize(bytes)
  if (!size) return undefined
  const format: 'PNG' | 'JPEG' = /\.(jpe?g)$/i.test(href) || (bytes[0] === 0xff && bytes[1] === 0xd8) ? 'JPEG' : 'PNG'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { type: 'image', dataUri: `data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${btoa(binary)}`, format, w: size.w, h: size.h }
}

// ── Renderizador a PDF ───────────────────────────────────────────────────────
function headingSize(level: number): number {
  return level <= 1 ? 18 : level === 2 ? 15 : level === 3 ? 13 : 12
}

function fontStyleFor(baseBold: boolean, run: Run): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  const bold = baseBold || !!run.bold
  const italic = !!run.italic
  return bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'
}

interface JsPdfLike {
  internal: { pageSize: { getWidth(): number; getHeight(): number } }
  setFontSize(size: number): void
  setFont(family: string, style: string): void
  getTextWidth(text: string): number
  text(text: string, x: number, y: number): void
  addPage(): void
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  output(type: 'arraybuffer'): ArrayBuffer
  lastAutoTable?: { finalY: number }
}

const MARGIN = 15
const TOP = 20

export async function renderBlocksToPdf(blocks: Block[], baseName: string): Promise<ConversionResult> {
  if (!blocks.length) throw new Error('El documento no contiene contenido convertible.')
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const pdf = new jsPDF() as unknown as JsPdfLike
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const maxW = pageW - MARGIN * 2
  let y = TOP

  const drawRuns = (runs: Run[], x: number, size: number, baseBold: boolean): void => {
    pdf.setFontSize(size)
    const lineH = size * 0.5
    let cursor = x
    const newline = () => {
      y += lineH
      cursor = x
      if (y > pageH - MARGIN) { pdf.addPage(); y = TOP }
    }
    for (const run of runs) {
      const style = fontStyleFor(baseBold, run)
      pdf.setFont('helvetica', style)
      for (const piece of run.text.split(/(\s+)/)) {
        if (!piece) continue
        if (piece === '\n') { newline(); continue }
        const width = pdf.getTextWidth(piece)
        if (/^\s+$/.test(piece)) { if (cursor > x) cursor += width; continue }
        if (cursor + width > x + maxW && cursor > x) { newline(); pdf.setFont('helvetica', style) }
        pdf.text(piece, cursor, y)
        cursor += width
      }
    }
    y += lineH
  }

  for (const block of blocks) {
    if (block.type === 'table') {
      const hasHead = block.rows.length > 1
      autoTable(pdf as never, {
        startY: y,
        head: hasHead ? [block.rows[0]] : undefined,
        body: hasHead ? block.rows.slice(1) : block.rows,
        styles: { overflow: 'linebreak', cellWidth: 'wrap', fontSize: 9 },
        margin: { left: MARGIN, right: MARGIN },
        horizontalPageBreak: true,
      })
      y = (pdf.lastAutoTable?.finalY ?? y) + 6
    } else if (block.type === 'image') {
      let drawW = maxW
      let drawH = (block.h / block.w) * drawW
      const maxH = pageH - TOP - MARGIN
      if (drawH > maxH) { drawH = maxH; drawW = (block.w / block.h) * drawH }
      if (y + drawH > pageH - MARGIN) { pdf.addPage(); y = TOP }
      try {
        pdf.addImage(block.dataUri, block.format, MARGIN, y, drawW, drawH)
        y += drawH + 6
      } catch {
        // Imagen ilegible o no soportada: se omite sin abortar el documento.
      }
    } else if (block.type === 'list') {
      block.items.forEach((item, index) => {
        const prefix: Run = { text: block.ordered ? `${index + 1}. ` : '• ' }
        drawRuns([prefix, ...item], MARGIN + 4, 11, false)
        y += 1
      })
      y += 3
    } else {
      const size = block.type === 'heading' ? headingSize(block.level) : 11
      if (y > pageH - MARGIN) { pdf.addPage(); y = TOP }
      drawRuns(block.runs, MARGIN, size, block.type === 'heading')
      y += size * 0.35
    }
  }

  const buffer = pdf.output('arraybuffer')
  return { name: `${baseName}.pdf`, mime: 'application/pdf', buffer, sizeBytes: buffer.byteLength, previewKind: 'pdf' }
}
