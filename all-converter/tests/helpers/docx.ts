/**
 * Constructores de fixtures DOCX en memoria con jszip, espejo de `odf.ts`, para no
 * versionar blobs binarios y poder generar los casos raros que rompen la correlación
 * posicional entre `wp:extent` y las `<img>` de mammoth (spec 005, FR-004).
 *
 * Estructura mínima que mammoth acepta: `word/document.xml` (obligatorio) +
 * `word/_rels/document.xml.rels` + las partes de imagen. `[Content_Types].xml` se
 * incluye por realismo y es imprescindible para tipos fuera del fallback por extensión.
 *
 * Mammoth resuelve los nombres por URI de namespace, no por prefijo, así que las
 * declaraciones `xmlns:` tienen que ser las transitional exactas.
 */
import JSZip from 'jszip'
import { pngBytes } from './odf'

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
} as const

/** EMU por pulgada, para escribir tamaños legibles en los fixtures. */
export const EMU_PER_INCH = 914400

// ── PNG de tamaño arbitrario ─────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * PNG válido con el IHDR reescrito a `w`×`h`.
 *
 * Los píxeles siguen siendo los del PNG de 1×1: alcanza para `imageSize()` (que lee el
 * IHDR) y para que cada fixture tenga un contenido distinto, que es lo que se está
 * probando. No se usa para comparar píxeles.
 */
export function pngOfSize(w: number, h: number): Uint8Array {
  const bytes = pngBytes().slice()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  view.setUint32(16, w)
  view.setUint32(20, h)
  // El CRC del IHDR cubre el nombre del chunk y sus datos: bytes 12..28.
  view.setUint32(29, crc32(bytes.subarray(12, 29)))
  return bytes
}

// ── Piezas de document.xml ───────────────────────────────────────────────────
export interface DrawingOptions {
  /** Sin `relationshipId` el dibujo no lleva `a:blip`: simula un gráfico o un SmartArt. */
  relationshipId?: string
  /** En EMU. Omitido, el dibujo no declara `wp:extent`. */
  cx?: number
  cy?: number
  /** `wp:anchor` en vez de `wp:inline`. */
  anchor?: boolean
  /** Prefijo alternativo para el namespace de wordprocessingDrawing. */
  prefix?: string
  /** Tamaño de `a:ext` dentro de `pic:spPr`, que NO debe confundirse con `wp:extent`. */
  spPrCx?: number
  spPrCy?: number
}

/** Un `<w:drawing>` completo dentro de su párrafo. */
export function drawing(options: DrawingOptions = {}): string {
  const wp = options.prefix ?? 'wp'
  const container = options.anchor ? 'anchor' : 'inline'
  const extent = options.cx !== undefined && options.cy !== undefined ? `<${wp}:extent cx="${options.cx}" cy="${options.cy}"/>` : ''
  const spPr =
    options.spPrCx !== undefined
      ? `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${options.spPrCx}" cy="${options.spPrCy ?? options.spPrCx}"/></a:xfrm></pic:spPr>`
      : ''
  const graphicData = options.relationshipId
    ? `<a:graphicData uri="${NS.pic}"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="0" name="imagen"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${options.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `${spPr}</pic:pic></a:graphicData>`
    : // Sin pic:pic no hay a:blip: es el caso del gráfico de Excel o el cuadro de texto.
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData>`
  return (
    `<w:p><w:r><w:drawing><${wp}:${container}>${extent}<${wp}:docPr id="1" name="Imagen"/>` +
    `<a:graphic>${graphicData}</a:graphic></${wp}:${container}></w:drawing></w:r></w:p>`
  )
}

export function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
}

export function documentXml(bodyXml: string, extraNamespaces: Record<string, string> = {}): string {
  const declared = { ...NS, ...extraNamespaces }
  const xmlns = Object.entries(declared)
    .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
    .join(' ')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${xmlns}><w:body>${bodyXml}</w:body></w:document>`
}

function contentTypes(media: Record<string, Uint8Array>): string {
  const extensions = new Set(Object.keys(media).map((path) => path.split('.').pop()?.toLowerCase() ?? ''))
  const types: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', emf: 'image/x-emf', wmf: 'image/x-wmf' }
  const defaults = [...extensions]
    .filter((extension) => types[extension])
    .map((extension) => `<Default Extension="${extension}" ContentType="${types[extension]}"/>`)
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${defaults}` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`
  )
}

/** `rId` → ruta relativa a `word/`, tal como las escribe Word. */
export function relationshipsXml(targets: Record<string, string>): string {
  const entries = Object.entries(targets)
    .map(([id, target]) => `<Relationship Id="${id}" Type="${NS.r}/image" Target="${target}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`
}

export interface DocxOptions {
  /** Contenido de `<w:body>`. */
  body: string
  /** `rId` → ruta relativa a `word/` (p. ej. `media/img.png`). */
  relationships?: Record<string, string>
  /** Ruta completa dentro del zip → bytes. */
  media?: Record<string, Uint8Array>
}

export async function packDocx(options: DocxOptions): Promise<Uint8Array> {
  const media = options.media ?? {}
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes(media))
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="${NS.r}/officeDocument" Target="word/document.xml"/></Relationships>`,
  )
  zip.file('word/document.xml', options.body)
  zip.file('word/_rels/document.xml.rels', relationshipsXml(options.relationships ?? {}))
  for (const [path, bytes] of Object.entries(media)) zip.file(path, bytes)
  return zip.generateAsync({ type: 'uint8array' })
}

/**
 * DOCX de una sola imagen de tamaño conocido: 2 in × 1 in = 50,8 mm × 25,4 mm.
 * `leadingChart` antepone un gráfico con otro `wp:extent`, que es el caso que rompería
 * una correlación por posición.
 */
export function buildImageDocx(options: { leadingChart?: boolean; withExtent?: boolean } = {}): Promise<Uint8Array> {
  const image = pngOfSize(200, 100)
  const chart = options.leadingChart ? drawing({ cx: 5486400, cy: 3200400 }) : ''
  const body =
    paragraph('Documento con imagen') +
    chart +
    drawing({
      relationshipId: 'rId1',
      ...(options.withExtent === false ? {} : { cx: EMU_PER_INCH * 2, cy: EMU_PER_INCH }),
    })
  return packDocx({
    body: documentXml(body),
    relationships: { rId1: 'media/img.png' },
    media: { 'word/media/img.png': image },
  })
}
