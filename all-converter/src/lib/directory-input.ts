import type { FileEntry } from '../converters/types'
import { detectFileType } from './file-type'

export const MAX_BATCH_FILES = 10

export interface IncomingFile { file: File; relativePath?: string }

/** Lee recursivamente los items soltados (archivos y carpetas) conservando la ruta relativa. */
export async function readDroppedItems(items: DataTransferItemList): Promise<IncomingFile[]> {
  const entries = Array.from(items).map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }))
  const collected: IncomingFile[] = []
  async function walk(entry: FileSystemEntry, path: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      collected.push({ file, relativePath: `${path}${file.name}` })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        for (const child of batch) await walk(child, `${path}${entry.name}/`)
      } while (batch.length)
    }
  }
  for (const { entry, file } of entries) {
    if (entry) await walk(entry, '')
    else if (file) collected.push({ file })
  }
  return collected
}

/**
 * Aplica las reglas de ingreso del lote (FR-023): hasta 10 archivos del mismo formato
 * que el primero aceptado; el resto se rechaza con motivo específico.
 */
export async function intakeFiles(incoming: readonly IncomingFile[], existing: readonly FileEntry[] = []): Promise<FileEntry[]> {
  const formatKey = (type: FileEntry['detectedType']): string => type.mime || type.extension
  const accepted = existing.filter((entry) => entry.state !== 'rejected')
  let batchFormat = accepted[0] ? formatKey(accepted[0].detectedType) : undefined
  let acceptedCount = accepted.length
  const entries: FileEntry[] = []
  for (const { file, relativePath } of incoming) {
    const detectedType = await detectFileType(file)
    const base = { id: crypto.randomUUID(), file, name: file.name, sizeBytes: file.size, detectedType, relativePath }
    if (file.size === 0) { entries.push({ ...base, state: 'rejected', rejectionReason: 'El archivo está vacío.' }); continue }
    if (detectedType.kind === 'unknown') { entries.push({ ...base, state: 'rejected', rejectionReason: `Tipo no soportado (${detectedType.mime || detectedType.extension || 'desconocido'}): no hay conversiones disponibles.` }); continue }
    if (batchFormat && formatKey(detectedType) !== batchFormat) { entries.push({ ...base, state: 'rejected', rejectionReason: `Formato distinto al del lote actual: el lote acepta ${batchFormat}.` }); continue }
    if (acceptedCount >= MAX_BATCH_FILES) { entries.push({ ...base, state: 'rejected', rejectionReason: `Límite de ${MAX_BATCH_FILES} archivos por lote excedido.` }); continue }
    batchFormat ??= formatKey(detectedType)
    acceptedCount += 1
    entries.push({ ...base, state: 'ready' })
  }
  return entries
}
