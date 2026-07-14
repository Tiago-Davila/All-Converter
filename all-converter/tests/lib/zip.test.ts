import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createZip, resolveZipPaths } from '../../src/lib/zip'

const buffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer

describe('zip', () => {
  it('replica las rutas relativas de origen en el ZIP', async () => {
    const zip = await JSZip.loadAsync(await createZip([
      { name: 'a.jpg', buffer: buffer('a'), relativePath: 'fotos/a.png' },
      { name: 'b.jpg', buffer: buffer('b'), relativePath: 'fotos/sub/b.png' },
      { name: 'suelto.jpg', buffer: buffer('c') },
    ]))
    expect(zip.file('fotos/a.jpg')).toBeTruthy()
    expect(zip.file('fotos/sub/b.jpg')).toBeTruthy()
    expect(zip.file('suelto.jpg')).toBeTruthy()
  })

  it('resuelve colisiones dentro de una misma ruta con sufijos numéricos', () => {
    const paths = resolveZipPaths([
      { name: 'informe.pdf', buffer: buffer('1'), relativePath: 'docs/informe.docx' },
      { name: 'informe.pdf', buffer: buffer('2'), relativePath: 'docs/otro/informe.docx' },
      { name: 'informe.pdf', buffer: buffer('3'), relativePath: 'docs/informe2.docx' },
      { name: 'informe.pdf', buffer: buffer('4'), relativePath: 'docs/informe3.docx' },
    ])
    expect(paths).toEqual(['docs/informe.pdf', 'docs/otro/informe.pdf', 'docs/informe-2.pdf', 'docs/informe-3.pdf'])
  })

  it('el contenido del ZIP conserva los bytes originales', async () => {
    const zip = await JSZip.loadAsync(await createZip([{ name: 'hola.txt', buffer: buffer('hola mundo') }]))
    await expect(zip.file('hola.txt')?.async('string')).resolves.toBe('hola mundo')
  })
})
