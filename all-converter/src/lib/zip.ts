import JSZip from 'jszip'

export interface ZipEntry {
  name: string
  buffer: ArrayBuffer
  /** Ruta relativa del archivo de origen (si vino de una carpeta); define la carpeta del resultado dentro del ZIP. */
  relativePath?: string
}

/** Resuelve la ruta final de cada entrada: replica subcarpetas y desambigua colisiones con sufijos numéricos por ruta. */
export function resolveZipPaths(entries: readonly ZipEntry[]): string[] {
  const used = new Set<string>()
  return entries.map((entry) => {
    const directory = entry.relativePath?.includes('/') ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/') + 1) : ''
    const dot = entry.name.lastIndexOf('.')
    const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name
    const extension = dot > 0 ? entry.name.slice(dot) : ''
    let candidate = `${directory}${entry.name}`
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${directory}${stem}-${suffix}${extension}`
    used.add(candidate)
    return candidate
  })
}

export async function createZip(entries: readonly ZipEntry[]): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const paths = resolveZipPaths(entries)
  entries.forEach((entry, index) => zip.file(paths[index], new Uint8Array(entry.buffer)))
  return zip.generateAsync({ type: 'arraybuffer' })
}
