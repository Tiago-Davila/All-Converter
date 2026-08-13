/**
 * Carpeta de lote grande para los tests e2e (006 T001).
 *
 * Se genera copiando `tests/fixtures/sample.png` en un directorio temporal en vez de versionar
 * 60 binarios idénticos: son imágenes reales (las mismas magic bytes que ve `detectFileType`)
 * y el repo no engorda.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Crea una carpeta con `count` PNG reales y devuelve su ruta absoluta. */
export async function makeImageFolder(count: number, folderName = 'lote-grande'): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'convertitodo-'))
  const folder = path.join(root, folderName)
  await mkdir(folder)
  const png = await readFile(path.resolve('tests/fixtures/sample.png'))
  await Promise.all(Array.from({ length: count }, (_, index) => writeFile(path.join(folder, `foto-${index}.png`), png)))
  return folder
}
