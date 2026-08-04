/**
 * docx-image-size: recupera el tamaño de VISUALIZACIÓN de las imágenes de un DOCX.
 *
 * mammoth entrega los bytes de cada imagen pero descarta su tamaño: `documents.Image()`
 * solo expone `read*`, `altText` y `contentType`, y `readDrawingElement` nunca mira
 * `wp:extent`. El dato vive únicamente en `word/document.xml`, así que hay que ir a
 * buscarlo al paquete.
 *
 * La asociación con cada imagen se hace por HUELLA DEL CONTENIDO, no por posición: un
 * gráfico, un SmartArt o un cuadro de texto tienen `wp:extent` y no producen ninguna
 * `<img>`, y un EMF/SVG produce una `<img>` que el renderizador descarta. Cualquiera de
 * los dos corre todos los índices posteriores (ver spec 005, FR-004).
 *
 * Como el resto de este dominio, el XML se parsea con expresiones regulares: los Web
 * Workers no tienen DOM.
 */
import type { DisplaySize } from './office-doc-render'

/** Un EMU (English Metric Unit) es 1/914400 de pulgada. */
export function emuToMm(emu: number): number {
  return (emu / 914400) * 25.4
}

/** Hash FNV-1a de 32 bits. Solo se usa como clave de agrupación, no como garantía criptográfica. */
export function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Clave de contenido. Incluye el largo para que una colisión de hash no baste para confundir dos partes. */
export function imageFingerprint(bytes: Uint8Array): string {
  return `${bytes.length}:${fnv1a32(bytes)}`
}

// ── Namespaces ───────────────────────────────────────────────────────────────
// mammoth resuelve por URI, no por prefijo, así que el prefijo literal no está
// garantizado. Se contemplan las URIs transitional y las strict.
const WORDPROCESSING_DRAWING = [
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing',
]
const RELATIONSHIPS = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]

/** Prefijo declarado para alguna de esas URIs, o el de reserva si el documento no las declara. */
export function namespacePrefix(xml: string, uris: readonly string[], fallback: string): string {
  for (const uri of uris) {
    const declared = new RegExp(`xmlns:([\\w.-]+)\\s*=\\s*"${uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').exec(xml)
    if (declared) return declared[1]
  }
  return fallback
}

const escapePrefix = (prefix: string) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── Relaciones (rId → ruta dentro del zip) ───────────────────────────────────
/**
 * Normaliza igual que mammoth (`lib/docx/uris.js`): un target absoluto pierde la barra
 * inicial; uno relativo se resuelve contra `word/`.
 */
export function relationshipTargetToPath(target: string): string {
  const decoded = target.replace(/&amp;/g, '&')
  return decoded.startsWith('/') ? decoded.slice(1) : `word/${decoded}`
}

export function parseRelationships(relsXml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const relationship of relsXml.matchAll(/<[\w.-]*:?Relationship\b([^>]*)\/?>/gi)) {
    const attributes = relationship[1]
    const id = /\bId\s*=\s*"([^"]+)"/i.exec(attributes)?.[1]
    const target = /\bTarget\s*=\s*"([^"]+)"/i.exec(attributes)?.[1]
    const mode = /\bTargetMode\s*=\s*"([^"]+)"/i.exec(attributes)?.[1]
    // Los targets externos apuntan fuera del paquete: no hay bytes que asociar.
    if (!id || !target || mode?.toLowerCase() === 'external') continue
    map.set(id, relationshipTargetToPath(target))
  }
  return map
}

// ── Dibujos (wp:extent + a:blip) ─────────────────────────────────────────────
export interface DocxDrawing {
  relationshipId: string
  size: DisplaySize
}

/** Descarta EMU no finitos, no positivos o absurdos (Word escribe cx="0" en dibujos corruptos). */
function sizeFromExtent(cx: number, cy: number): DisplaySize | undefined {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return undefined
  const wmm = emuToMm(cx)
  const hmm = emuToMm(cy)
  return wmm > 0 && hmm > 0 && wmm < 5000 && hmm < 5000 ? { wmm, hmm } : undefined
}

/**
 * Recorre los `wp:inline` / `wp:anchor` del documento.
 *
 * Solo se conserva el extent de los dibujos que además tienen `<a:blip r:embed>`: es
 * justamente lo que evita que un gráfico o un SmartArt le preste su tamaño a la imagen
 * siguiente. El `wp:extent` se ancla al prefijo porque `a:ext`, dentro de `pic:spPr`,
 * también usa los atributos `cx`/`cy`.
 */
export function parseDocxDrawings(documentXml: string): DocxDrawing[] {
  const wp = escapePrefix(namespacePrefix(documentXml, WORDPROCESSING_DRAWING, 'wp'))
  const r = escapePrefix(namespacePrefix(documentXml, RELATIONSHIPS, 'r'))
  const drawings: DocxDrawing[] = []
  const container = new RegExp(`<${wp}:(inline|anchor)\\b[^>]*>([\\s\\S]*?)<\\/${wp}:\\1>`, 'gi')
  const extentPattern = new RegExp(`<${wp}:extent\\b([^>]*)>`, 'i')
  const blipPattern = new RegExp(`<[\\w.-]+:blip\\b([^>]*)>`, 'i')
  for (const match of documentXml.matchAll(container)) {
    const inner = match[2]
    const blip = blipPattern.exec(inner)?.[1]
    if (!blip) continue
    const relationshipId =
      new RegExp(`\\b${r}:(?:embed|link)\\s*=\\s*"([^"]+)"`, 'i').exec(blip)?.[1]
    if (!relationshipId) continue
    const extent = extentPattern.exec(inner)?.[1]
    if (!extent) continue
    const cx = Number(/\bcx\s*=\s*"(-?\d+)"/i.exec(extent)?.[1])
    const cy = Number(/\bcy\s*=\s*"(-?\d+)"/i.exec(extent)?.[1])
    const size = sizeFromExtent(cx, cy)
    if (size) drawings.push({ relationshipId, size })
  }
  return drawings
}

// ── Búsqueda por contenido ───────────────────────────────────────────────────
export type DisplayLookup = (bytes: Uint8Array) => DisplaySize | undefined

/** Un join sospechoso (aspectos muy dispares) se descarta: mejor el tamaño intrínseco que uno inventado. */
function plausible(size: DisplaySize, bytes: Uint8Array, intrinsic?: { w: number; h: number }): boolean {
  if (!intrinsic || !intrinsic.w || !intrinsic.h) return true
  const declared = size.wmm / size.hmm
  const natural = intrinsic.w / intrinsic.h
  if (!Number.isFinite(declared) || !Number.isFinite(natural) || natural <= 0) return true
  const ratio = declared / natural
  return ratio > 1 / 20 && ratio < 20 && bytes.length > 0
}

interface Entry {
  sizes: DisplaySize[]
  cursor: number
}

/**
 * Fuentes de tamaño agrupadas por huella de contenido.
 *
 * `parts` mapea ruta del zip → bytes; `drawings` son los dibujos en orden de documento.
 * Si una misma parte aparece más veces de las que hay extents y todos sus tamaños
 * coinciden (el caso del logo repetido), el tamaño se reutiliza sin consumirse.
 */
export function buildDisplayLookup(
  drawings: readonly DocxDrawing[],
  relationships: ReadonlyMap<string, string>,
  parts: ReadonlyMap<string, Uint8Array>,
  intrinsicSize?: (bytes: Uint8Array) => { w: number; h: number } | undefined,
): DisplayLookup {
  const byFingerprint = new Map<string, Entry>()
  for (const drawing of drawings) {
    const path = relationships.get(drawing.relationshipId)
    const bytes = path ? parts.get(path) : undefined
    if (!bytes) continue
    const key = imageFingerprint(bytes)
    const entry = byFingerprint.get(key) ?? { sizes: [], cursor: 0 }
    entry.sizes.push(drawing.size)
    byFingerprint.set(key, entry)
  }
  return (bytes) => {
    const entry = byFingerprint.get(imageFingerprint(bytes))
    if (!entry || !entry.sizes.length) return undefined
    const uniform = entry.sizes.every((size) => size.wmm === entry.sizes[0].wmm && size.hmm === entry.sizes[0].hmm)
    const size = uniform ? entry.sizes[0] : entry.sizes[entry.cursor]
    if (!size) return undefined
    if (!uniform) entry.cursor++
    return plausible(size, bytes, intrinsicSize?.(bytes)) ? size : undefined
  }
}

interface ZipLike {
  file(path: string): { async(type: 'string'): Promise<string> } | null
  files: Record<string, { async(type: 'uint8array'): Promise<Uint8Array> }>
}

/**
 * Punto de entrada: arma el `DisplayLookup` de un DOCX ya abierto con JSZip.
 * Devuelve un lookup vacío —nunca lanza— si el paquete no trae lo necesario: el
 * renderizador degrada entonces a los píxeles intrínsecos (FR-005).
 */
export async function extractDocxImageSizes(
  zip: ZipLike,
  intrinsicSize?: (bytes: Uint8Array) => { w: number; h: number } | undefined,
): Promise<DisplayLookup> {
  const documentFile = zip.file('word/document.xml')
  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (!documentFile || !relsFile) return () => undefined
  const [documentXml, relsXml] = await Promise.all([documentFile.async('string'), relsFile.async('string')])
  const drawings = parseDocxDrawings(documentXml)
  if (!drawings.length) return () => undefined
  const relationships = parseRelationships(relsXml)
  const wanted = new Set([...drawings].map((drawing) => relationships.get(drawing.relationshipId)).filter((path): path is string => !!path))
  const parts = new Map<string, Uint8Array>()
  await Promise.all(
    [...wanted]
      .filter((path) => zip.files[path])
      .map(async (path) => { parts.set(path, await zip.files[path].async('uint8array')) }),
  )
  return buildDisplayLookup(drawings, relationships, parts, intrinsicSize)
}
