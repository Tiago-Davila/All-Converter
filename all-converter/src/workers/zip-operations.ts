import { resolveZipPaths } from '../lib/zip-paths'
import type { ZipInput } from './types'

/**
 * Escritor ZIP incremental, método STORE (sin compresión).
 *
 * Por qué propio y no JSZip: se midió que `zip.file(nombre, blob)` lee el blob ENTERO en el
 * acto y retiene los bytes hasta el `generate`, así que el pico de memoria sería la suma de
 * todas las salidas — justo lo que esta feature evita. Además JSZip sólo sabe leer un Blob si
 * existe `FileReader`, que en Node no existe, y los tests corren con `environment: 'node'`.
 * Ver specs/006-lotes-grandes/research.md D1.
 *
 * STORE y no DEFLATE porque las salidas ya vienen comprimidas (PNG/JPG/PDF/MP3/MP4).
 *
 * Sin ZIP64: los offsets y tamaños son de 32 bits. Por encima de 4 GB se rechaza con aviso
 * en vez de emitir un archivo corrupto.
 */

const SIGNATURE_LOCAL = 0x04034b50
const SIGNATURE_CENTRAL = 0x02014b50
const SIGNATURE_EOCD = 0x06054b50
/** Bit 11 del flag de propósito general: el nombre está en UTF-8. */
const FLAG_UTF8 = 0x800
const VERSION_STORE = 20
const ZIP32_LIMIT = 0xffffffff

const encoder = new TextEncoder()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Escritor de campos little-endian, que es como el formato ZIP guarda sus enteros. */
class ByteWriter {
  private readonly bytes: Uint8Array
  private offset = 0
  constructor(size: number) { this.bytes = new Uint8Array(size) }
  u16(value: number): this { this.bytes[this.offset++] = value & 0xff; this.bytes[this.offset++] = (value >>> 8) & 0xff; return this }
  u32(value: number): this { this.u16(value & 0xffff); this.u16((value >>> 16) & 0xffff); return this }
  raw(value: Uint8Array): this { this.bytes.set(value, this.offset); this.offset += value.length; return this }
  done(): Uint8Array { return this.bytes }
}

interface CentralEntry { name: Uint8Array; crc: number; size: number; offset: number }

function localHeader(name: Uint8Array, crc: number, size: number): Uint8Array {
  return new ByteWriter(30 + name.length)
    .u32(SIGNATURE_LOCAL).u16(VERSION_STORE).u16(FLAG_UTF8)
    .u16(0 /* método STORE */).u16(0 /* hora */).u16(0 /* fecha */)
    .u32(crc).u32(size /* comprimido */).u32(size /* sin comprimir */)
    .u16(name.length).u16(0 /* campo extra */)
    .raw(name)
    .done()
}

function centralHeader(entry: CentralEntry): Uint8Array {
  return new ByteWriter(46 + entry.name.length)
    .u32(SIGNATURE_CENTRAL).u16(VERSION_STORE).u16(VERSION_STORE).u16(FLAG_UTF8)
    .u16(0 /* método STORE */).u16(0 /* hora */).u16(0 /* fecha */)
    .u32(entry.crc).u32(entry.size).u32(entry.size)
    .u16(entry.name.length).u16(0 /* extra */).u16(0 /* comentario */)
    .u16(0 /* disco */).u16(0 /* atributos internos */).u32(0 /* atributos externos */)
    .u32(entry.offset)
    .raw(entry.name)
    .done()
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  return new ByteWriter(22)
    .u32(SIGNATURE_EOCD).u16(0 /* disco */).u16(0 /* disco del directorio */)
    .u16(count).u16(count).u32(size).u32(offset).u16(0 /* comentario */)
    .done()
}

/**
 * Genera el ZIP trozo a trozo. Lee UN blob por vez y suelta sus bytes antes de pasar al
 * siguiente: el pico de memoria es el archivo más grande, no la suma del lote.
 */
export async function* streamZip(inputs: readonly ZipInput[]): AsyncGenerator<Uint8Array> {
  const total = inputs.reduce((sum, input) => sum + input.blob.size, 0)
  if (total > ZIP32_LIMIT) {
    throw new Error(
      `El ZIP superaría los 4 GB (${(total / 1024 / 1024 / 1024).toFixed(1)} GB) y ese formato no lo admite. ` +
      'Descargá los archivos de a uno.',
    )
  }

  const paths = resolveZipPaths(inputs)
  const central: CentralEntry[] = []
  let offset = 0

  for (const [index, input] of inputs.entries()) {
    // Una lectura por vez. `blob.arrayBuffer()` y no FileReader: existe en navegador,
    // en workers y en Node, que es donde corren los tests.
    const bytes = new Uint8Array(await input.blob.arrayBuffer())
    const name = encoder.encode(paths[index])
    const crc = crc32(bytes)

    const header = localHeader(name, crc, bytes.length)
    yield header
    yield bytes

    central.push({ name, crc, size: bytes.length, offset })
    offset += header.length + bytes.length
  }

  const directoryOffset = offset
  let directorySize = 0
  for (const entry of central) {
    const record = centralHeader(entry)
    directorySize += record.length
    yield record
  }
  yield endOfCentralDirectory(central.length, directorySize, directoryOffset)
}

/** Empaqueta en un único `ArrayBuffer`. Sólo para tests y para lotes chicos. */
export async function executeZip(inputs: readonly ZipInput[]): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of streamZip(inputs)) { chunks.push(chunk); size += chunk.length }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out.buffer
}
