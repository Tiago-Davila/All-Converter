import type { FileEntry } from '../converters/types'
import { detectFileType } from './file-type'
import { runWithConcurrency } from './job-scheduler'

export const MAX_BATCH_FILES = 200
/** Techo del recorrido recursivo: un árbol patológico no puede colgar la pestaña (FR-003). */
export const MAX_SCAN_FILES = 5000

export interface IncomingFile { file: File; relativePath?: string }

export interface ScanResult {
  files: IncomingFile[]
  /** Cuántos quedaron sin explorar por haber alcanzado MAX_SCAN_FILES. */
  skipped: number
}

/**
 * Lee recursivamente los items soltados (archivos y carpetas) conservando la ruta relativa.
 * Corta al alcanzar MAX_SCAN_FILES: soltar una carpeta de 50.000 archivos no puede dejar la
 * app leyendo el árbol entero antes de responder.
 */
export async function readDroppedItems(items: DataTransferItemList): Promise<ScanResult> {
  const entries = Array.from(items).map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }))
  const collected: IncomingFile[] = []
  let skipped = 0

  async function walk(entry: FileSystemEntry, path: string): Promise<void> {
    if (collected.length >= MAX_SCAN_FILES) { skipped += 1; return }
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      collected.push({ file, relativePath: `${path}${file.name}` })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        for (const child of batch) await walk(child, `${path}${entry.name}/`)
      } while (batch.length && collected.length < MAX_SCAN_FILES)
    }
  }

  for (const { entry, file } of entries) {
    if (entry) await walk(entry, '')
    else if (file && collected.length < MAX_SCAN_FILES) collected.push({ file })
  }
  return { files: collected, skipped }
}

/** Rechazos que se evalúan sin leer el contenido del archivo. */
function cheapRejection(file: File): string | undefined {
  return file.size === 0 ? 'El archivo está vacío.' : undefined
}

/**
 * Aplica las reglas de ingreso del lote (001 FR-023, 006 FR-001/FR-002): hasta
 * MAX_BATCH_FILES archivos en total, con formatos de origen mezclados. Un archivo nunca se
 * rechaza por diferir del formato de otro; solo por estar vacío, ser de tipo no soportado o
 * exceder el tope de la cola.
 *
 * Orden deliberado: primero lo que se decide sin leer bytes (vacío, cupo) y recién después la
 * detección por magic bytes, que lee el blob. Así soltar una carpeta de 5000 archivos con la
 * cola llena no cuesta 5000 lecturas para descartarlos (FR-002). Se preserva que un archivo
 * vacío se rechace por vacío y no consuma cuota.
 */
export async function intakeFiles(incoming: readonly IncomingFile[], existing: readonly FileEntry[] = []): Promise<FileEntry[]> {
  let remaining = MAX_BATCH_FILES - existing.filter((entry) => entry.state !== 'rejected').length

  const unknownType = (file: File) => ({
    kind: 'unknown' as const,
    mime: file.type,
    extension: file.name.split('.').pop()?.toLowerCase() ?? '',
    detection: 'extension' as const,
  })

  const results = new Array<FileEntry>(incoming.length)
  // Índices que todavía no se resolvieron y son candidatos a ocupar cupo.
  const queue: number[] = []

  incoming.forEach(({ file, relativePath }, index) => {
    const base = { id: crypto.randomUUID(), file, name: file.name, sizeBytes: file.size, relativePath }
    const cheap = cheapRejection(file)
    // El archivo vacío se rechaza por vacío, sin leer bytes y sin consumir cuota.
    if (cheap) { results[index] = { ...base, detectedType: unknownType(file), state: 'rejected', rejectionReason: cheap }; return }
    results[index] = { ...base, detectedType: unknownType(file), state: 'rejected', rejectionReason: `Límite de ${MAX_BATCH_FILES} archivos por lote excedido.` }
    queue.push(index)
  })

  // Se detecta por olas del tamaño del cupo libre. Un tipo no soportado no consume cuota, así
  // que si una ola deja lugar, la siguiente lo aprovecha. Nunca se leen bytes de archivos que
  // no podrían entrar ni en el mejor de los casos (FR-002).
  let cursor = 0
  while (remaining > 0 && cursor < queue.length) {
    const wave = queue.slice(cursor, cursor + remaining)
    cursor += wave.length
    const detected = await runWithConcurrency(wave.map((index) => () => detectFileType(incoming[index].file)), 4)

    wave.forEach((index, position) => {
      const settled = detected[position]
      const base = results[index]
      if (settled.status !== 'fulfilled') {
        results[index] = { ...base, state: 'rejected', rejectionReason: 'No se pudo leer el archivo.' }
        return
      }
      const detectedType = settled.value
      if (detectedType.kind === 'unknown') {
        results[index] = { ...base, detectedType, state: 'rejected', rejectionReason: `Tipo no soportado (${detectedType.mime || detectedType.extension || 'desconocido'}): no hay conversiones disponibles.` }
        return
      }
      remaining -= 1
      results[index] = { ...base, detectedType, state: 'ready', rejectionReason: undefined }
    })
  }

  return results
}
