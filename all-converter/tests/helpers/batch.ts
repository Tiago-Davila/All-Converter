/**
 * Dobles de conversor para los tests de lote (006 T002).
 *
 * Se usan mockeando el registry entero:
 *
 * ```ts
 * vi.mock('../../src/converters/registry', async () => (await import('../helpers/batch')).makeRegistryModule())
 * ```
 *
 * El comportamiento se elige por el nombre del archivo, para que un test arme la cola que
 * necesita sin tener que inyectar conversores distintos:
 *
 * | Nombre contiene | Qué hace |
 * |---|---|
 * | `malo`       | falla con "dañado o incompleto" |
 * | `protegido`  | falla con una causa **determinística** (contraseña) |
 * | `memoria`    | falla con una causa **transitoria** (sin memoria) |
 * | `control`    | queda colgado sin reportar progreso hasta que el test lo maneje o se aborte |
 * | cualquier otro | termina de inmediato con éxito |
 */
import type { ConversionProgress, ConversionResult, Converter, DetectedFileType, FileEntry } from '../../src/converters/types'

/** Nombres de archivo que pasaron por `convert`, en orden. */
export const converterCalls: string[] = []

/** Un trabajo colgado que el test maneja a mano (watchdog, cancelación, pausa). */
export interface ControlledJob {
  readonly file: File
  /** Emite un evento de progreso, que reinicia el plazo del watchdog. */
  emitProgress(percent: number): void
  /** Termina bien. */
  finish(): void
  /** Termina mal, con la causa que se le pase. */
  fail(message: string): void
  readonly signal: AbortSignal
}

/** Trabajos colgados vivos, por nombre de archivo. */
export const controlledJobs = new Map<string, ControlledJob>()

export function resetBatchDoubles(): void {
  converterCalls.length = 0
  controlledJobs.clear()
}

function output(file: File, target: string): ConversionResult[] {
  const buffer = new TextEncoder().encode(`${file.name}→${target}`).buffer
  return [{ name: file.name.replace(/\.[^.]+$/, `.${target}`), mime: `application/${target}`, buffer, sizeBytes: buffer.byteLength }]
}

function controlled(file: File, onProgress: (progress: ConversionProgress) => void, signal: AbortSignal, target: string): Promise<ConversionResult[]> {
  return new Promise<ConversionResult[]>((resolve, reject) => {
    const onAbort = () => { controlledJobs.delete(file.name); reject(new DOMException('Cancelado', 'AbortError')) }
    signal.addEventListener('abort', onAbort, { once: true })
    const settle = (run: () => void) => { signal.removeEventListener('abort', onAbort); controlledJobs.delete(file.name); run() }
    controlledJobs.set(file.name, {
      file,
      signal,
      emitProgress: (percent) => onProgress({ percent, stage: 'convirtiendo' }),
      finish: () => settle(() => resolve(output(file, target))),
      fail: (message) => settle(() => reject(new Error(message))),
    })
  })
}

async function fakeConvert(file: File, onProgress: (progress: ConversionProgress) => void, options: Record<string, unknown>, signal: AbortSignal): Promise<ConversionResult[]> {
  converterCalls.push(file.name)
  const target = String(options.target)
  if (file.name.includes('malo')) throw new Error('El archivo parece estar dañado o incompleto.')
  if (file.name.includes('protegido')) throw new Error('El archivo está protegido con contraseña.')
  if (file.name.includes('memoria')) throw new Error('No hay memoria suficiente para procesar el archivo.')
  if (file.name.includes('control')) return controlled(file, onProgress, signal, target)
  return output(file, target)
}

export const imageDouble: Converter = {
  id: 'fake-image',
  label: 'Convertir imagen',
  from: [{ kind: 'image', mimes: ['image/png'], extensions: ['png'] }],
  to: 'jpg|webp',
  maxSizeMB: 50,
  convert: fakeConvert,
}

export const sheetDouble: Converter = {
  id: 'fake-sheet',
  label: 'Convertir planilla',
  from: [{ kind: 'spreadsheet', mimes: ['text/csv'], extensions: ['csv'] }],
  to: 'xlsx',
  maxSizeMB: 25,
  convert: fakeConvert,
}

/** Conversor de audio: sirve para verificar el particionado de concurrencia (FR-017). */
export const audioDouble: Converter = {
  id: 'fake-audio',
  label: 'Convertir audio',
  from: [{ kind: 'audio', mimes: ['audio/mpeg'], extensions: ['mp3'] }],
  to: 'wav',
  maxSizeMB: 100,
  convert: fakeConvert,
}

const DOUBLES: readonly Converter[] = [imageDouble, sheetDouble, audioDouble]

function availableFor(type: DetectedFileType): readonly Converter[] {
  return DOUBLES.filter((converter) => converter.from.some((source) => source.kind === type.kind))
}

const targetsOf = (converter: Converter): readonly string[] => converter.to.split('|')

function choicesFor(entry: FileEntry) {
  return availableFor(entry.detectedType).flatMap((converter) => targetsOf(converter).map((target) => ({ converter, target })))
}

/** El módulo que reemplaza a `src/converters/registry` en los tests de lote. */
export function makeRegistryModule() {
  return {
    converters: DOUBLES,
    getAvailableConverters: availableFor,
    getConverterTargets: targetsOf,
    getCommonTargets: (entries: readonly FileEntry[]) => {
      if (!entries.length) return []
      const rest = entries.slice(1)
      return choicesFor(entries[0]).filter((choice) =>
        rest.every((entry) => choicesFor(entry).some((c) => c.converter.id === choice.converter.id && c.target === choice.target)))
    },
  }
}

/** Entrada de cola lista para convertir, del tipo que pida el test. */
export function queueEntry(name: string, kind: 'image' | 'spreadsheet' | 'audio' = 'image', relativePath?: string): FileEntry {
  const type: Record<typeof kind, DetectedFileType> = {
    image: { kind: 'image', mime: 'image/png', extension: 'png', detection: 'magic-bytes' },
    spreadsheet: { kind: 'spreadsheet', mime: 'text/csv', extension: 'csv', detection: 'magic-bytes' },
    audio: { kind: 'audio', mime: 'audio/mpeg', extension: 'mp3', detection: 'magic-bytes' },
  }
  return { id: name, file: new File(['x'], name), name, sizeBytes: 1, detectedType: type[kind], state: 'ready', relativePath }
}
