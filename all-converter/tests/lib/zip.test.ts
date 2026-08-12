import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createZip, resolveZipPaths, type ZipEntry } from '../../src/lib/zip'
import { streamZip } from '../../src/workers/zip-operations'

const blob = (text: string): Blob => new Blob([new TextEncoder().encode(text)])

/**
 * JSZip en Node no sabe leer un `Blob` (necesita `FileReader`), así que se le pasa el
 * ArrayBuffer. Leer con JSZip es a propósito: valida el formato contra otra implementación.
 */
async function reopen(entries: readonly ZipEntry[]): Promise<JSZip> {
  return JSZip.loadAsync(await (await createZip(entries)).arrayBuffer())
}

describe('zip', () => {
  it('replica las rutas relativas de origen en el ZIP', async () => {
    const zip = await reopen([
      { name: 'a.jpg', blob: blob('a'), relativePath: 'fotos/a.png' },
      { name: 'b.jpg', blob: blob('b'), relativePath: 'fotos/sub/b.png' },
      { name: 'suelto.jpg', blob: blob('c') },
    ])
    expect(zip.file('fotos/a.jpg')).toBeTruthy()
    expect(zip.file('fotos/sub/b.jpg')).toBeTruthy()
    expect(zip.file('suelto.jpg')).toBeTruthy()
  })

  it('resuelve colisiones dentro de una misma ruta con sufijos numéricos', () => {
    const paths = resolveZipPaths([
      { name: 'informe.pdf', relativePath: 'docs/informe.docx' },
      { name: 'informe.pdf', relativePath: 'docs/otro/informe.docx' },
      { name: 'informe.pdf', relativePath: 'docs/informe2.docx' },
      { name: 'informe.pdf', relativePath: 'docs/informe3.docx' },
    ])
    expect(paths).toEqual(['docs/informe.pdf', 'docs/otro/informe.pdf', 'docs/informe-2.pdf', 'docs/informe-3.pdf'])
  })

  it('el contenido del ZIP conserva los bytes originales', async () => {
    const zip = await reopen([{ name: 'hola.txt', blob: blob('hola mundo') }])
    await expect(zip.file('hola.txt')?.async('string')).resolves.toBe('hola mundo')
  })

  it('empaqueta un lote de 200 entradas con fidelidad de bytes (T012)', async () => {
    const entries: ZipEntry[] = Array.from({ length: 200 }, (_, index) => ({
      name: `archivo-${index}.txt`,
      blob: blob(`contenido número ${index}`),
      relativePath: `lote/sub-${index % 7}/archivo-${index}.png`,
    }))
    const zip = await reopen(entries)

    expect(Object.keys(zip.files)).toHaveLength(200)
    for (const index of [0, 1, 99, 198, 199]) {
      const path = `lote/sub-${index % 7}/archivo-${index}.txt`
      await expect(zip.file(path)?.async('string')).resolves.toBe(`contenido número ${index}`)
    }
  })

  it('conserva nombres con acentos y resuelve colisiones al empaquetar (T012)', async () => {
    const zip = await reopen([
      { name: 'ñandú-café.txt', blob: blob('acentos') },
      { name: 'informe.pdf', blob: blob('uno'), relativePath: 'docs/informe.docx' },
      { name: 'informe.pdf', blob: blob('dos'), relativePath: 'docs/otro.docx' },
    ])
    await expect(zip.file('ñandú-café.txt')?.async('string')).resolves.toBe('acentos')
    await expect(zip.file('docs/informe.pdf')?.async('string')).resolves.toBe('uno')
    await expect(zip.file('docs/informe-2.pdf')?.async('string')).resolves.toBe('dos')
  })

  it('conserva bytes binarios arbitrarios, no solo texto (T012)', async () => {
    const bytes = new Uint8Array(1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256
    const zip = await reopen([{ name: 'binario.bin', blob: new Blob([bytes]) }])
    const back = await zip.file('binario.bin')?.async('uint8array')
    expect(back).toEqual(bytes)
  })

  it('lee un blob por vez, nunca dos en simultáneo (T013)', async () => {
    let live = 0
    let maxLive = 0
    const tracked = (text: string): Blob => {
      const real = blob(text)
      return {
        size: real.size,
        async arrayBuffer() {
          live += 1
          maxLive = Math.max(maxLive, live)
          // Cede el turno: si el escritor arrancara otra lectura, se solaparían acá.
          await Promise.resolve()
          const buffer = await real.arrayBuffer()
          live -= 1
          return buffer
        },
      } as unknown as Blob
    }

    const inputs = Array.from({ length: 30 }, (_, index) => ({ name: `a-${index}.txt`, blob: tracked(`dato ${index}`) }))
    for await (const chunk of streamZip(inputs)) expect(chunk).toBeInstanceOf(Uint8Array)

    expect(maxLive).toBe(1)
    expect(live).toBe(0)
  })

  /**
   * El worker transfiere el buffer de cada trozo (`postMessage(..., [chunk.buffer])`), lo que
   * lo deja *detached* en el emisor. Si el generador vuelve a mirar `chunk.length` después de
   * emitirlo, lee 0 y escribe un directorio central con tamaños y offsets mentirosos: el ZIP
   * abre "bien" a simple vista y ningún lector puede extraerlo.
   */
  it('sobrevive a que el consumidor transfiera cada trozo (T013)', async () => {
    const inputs = Array.from({ length: 5 }, (_, index) => ({
      name: `archivo-${index}.txt`,
      blob: blob(`contenido ${index} `.repeat(20)),
    }))

    const copies: Uint8Array[] = []
    for await (const chunk of streamZip(inputs)) {
      copies.push(new Uint8Array(chunk))
      // Lo mismo que le hace el worker al trozo apenas lo emite.
      structuredClone(chunk.buffer, { transfer: [chunk.buffer] })
    }

    const zip = await JSZip.loadAsync(await new Blob(copies as BlobPart[]).arrayBuffer())
    expect(Object.keys(zip.files)).toHaveLength(5)
    await expect(zip.file('archivo-3.txt')?.async('string')).resolves.toBe('contenido 3 '.repeat(20))
  })

  it('avisa en vez de emitir un ZIP corrupto por encima de 4 GB (T013)', async () => {
    const huge = { name: 'enorme.bin', blob: { size: 5_000_000_000 } as unknown as Blob }
    const generator = streamZip([huge])
    await expect(generator.next()).rejects.toThrow(/4 GB/)
  })
})
