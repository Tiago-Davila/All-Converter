/**
 * FileQueue: cola por lotes con la identidad visual del mockup (DEP-001).
 * Agrupa por categoría (Imágenes / Documentos / Video / Audio / No soportados),
 * cada archivo elige su destino (001 FR-023b) y los estados usan color + forma
 * + texto (FR-015/FR-044). El sonido de fin de cola suena UNA vez por lote,
 * nunca por archivo (FR-029/FR-029b).
 */
import { useEffect, useRef, useState } from 'react'
import type { ConversionProgress, ConversionResult, Converter, FileEntry } from '../converters/types'
import { getAvailableConverters, getCommonTargets, getConverterTargets, type CommonChoice } from '../converters/registry'
import { MAX_BATCH_FILES, MAX_SCAN_FILES } from '../lib/directory-input'
import { makeRowError, type ErrorClass } from '../lib/error-class'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { concurrencyForConverter, runPartitioned, watchdogMsForConverter } from '../lib/job-scheduler'
import { saveZip } from '../lib/zip'
import { Icon, type IconName } from '../ui/components/icons'
import { LiveRegion, announcementText, type Announcement } from '../ui/a11y/LiveRegion'
import { playSound } from '../ui/sound/player'

interface BatchItem { state: 'queued' | 'converting' | 'completed' | 'error' | 'cancelled'; percent?: number; error?: string; errorClass?: ErrorClass }
/** Cómo terminó un archivo. Alimenta el resumen del lote (FR-016). */
type Outcome = 'done' | 'error' | 'cancelled'
interface Choice { converter: Converter; target: string }
interface RowDownload { url: string; name: string }
/** Opciones extra por fila según el conversor elegido (calidad, portada…). */
interface RowOptions { quality: number; maxWidth?: number; visual: 'waveform' | 'cover'; cover?: File; optionsOpen: boolean }

const DEFAULT_ROW_OPTIONS: RowOptions = { quality: 85, visual: 'waveform', optionsOpen: false }

/** Cada archivo elige su propio destino (FR-023b): las opciones salen del registry según su tipo detectado. */
function choicesFor(entry: FileEntry): Choice[] {
  return getAvailableConverters(entry.detectedType).flatMap((converter) =>
    getConverterTargets(converter, entry.detectedType).map((target) => ({ converter, target })))
}

const choiceKey = (choice: Choice): string => `${choice.converter.id}::${choice.target}`
const choiceLabel = (choice: Choice, many: boolean): string => (many ? `${choice.target.toUpperCase()} — ${choice.converter.label}` : choice.target.toUpperCase())

async function optionsFor(choice: Choice, entry: FileEntry, row: RowOptions): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = { target: choice.target, mime: choice.target === 'jpg' ? 'image/jpeg' : `image/${choice.target}` }
  if (choice.converter.id === 'audio-convert') { options.format = choice.target; options.sourceExtension = entry.detectedType.extension }
  if (choice.converter.id === 'image-convert') {
    options.quality = row.quality / 100
    if (row.maxWidth) options.maxWidth = row.maxWidth
  }
  if (choice.converter.id === 'mp3-to-mp4') {
    // Waveform automático por defecto: nunca bloquea "Convertir" (FR-028/FR-028c)
    options.generateWaveform = row.visual === 'waveform'
    if (row.visual === 'cover' && row.cover) {
      options.cover = await row.cover.arrayBuffer()
      options.coverName = row.cover.name
      options.coverMime = row.cover.type
    }
  }
  return options
}

/** Texto del vencimiento del watchdog. Es transitorio: reintentar puede funcionar. */
function watchdogMessage(budgetMs: number): string {
  return `Se detuvo por inactividad: el conversor no reportó avance en ${Math.round(budgetMs / 60000)} minutos.`
}

/**
 * Corre un conversor con watchdog propio (FR-015, contracts/reliability.md).
 *
 * Cada archivo tiene su `AbortController`, encadenado al del lote: abortar el lote los aborta
 * a todos, pero un archivo colgado se puede matar sin tocar a los demás. El plazo se reinicia
 * con cada evento de progreso, así que mide falta de avance y no duración.
 */
async function convertWatched(
  choice: Choice,
  file: File,
  onProgress: (progress: ConversionProgress) => void,
  options: Record<string, unknown>,
  batchSignal: AbortSignal,
): Promise<ConversionResult[]> {
  const budget = watchdogMsForConverter(choice.converter)
  const controller = new AbortController()
  const relayAbort = () => controller.abort()
  if (batchSignal.aborted) controller.abort()
  else batchSignal.addEventListener('abort', relayAbort, { once: true })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort() }, budget) }
  arm()

  try {
    return await choice.converter.convert(file, (progress) => { arm(); onProgress(progress) }, options, controller.signal)
  } catch (thrown) {
    // El vencimiento no es una cancelación del usuario: es un error transitorio de ese archivo.
    if (timedOut) throw new Error(watchdogMessage(budget))
    throw thrown
  } finally {
    if (timer) clearTimeout(timer)
    batchSignal.removeEventListener('abort', relayAbort)
  }
}

// ── Agrupación por carpeta ────────────────────────────────────────────────────

/** Extrae el nombre de carpeta del relativePath (primer segmento), o null si es archivo suelto. */
function folderOf(entry: FileEntry): string | null {
  if (!entry.relativePath) return null
  const parts = entry.relativePath.split('/')
  // relativePath = "carpeta/archivo.ext" → partes[0] = "carpeta"
  // Si solo hay un segmento, es un archivo suelto (no está dentro de subdirectorio)
  return parts.length > 1 ? parts[0] : null
}

interface FolderCategoryGroup { category: Category; list: FileEntry[] }
interface FolderGroup { folderName: string; byCategory: FolderCategoryGroup[] }

/** Archivos con carpeta, agrupados por carpeta y luego por categoría. */
function buildFolderGroups(entries: readonly FileEntry[]): FolderGroup[] {
  const map = new Map<string, FileEntry[]>()
  for (const entry of entries) {
    const folder = folderOf(entry)
    if (!folder) continue
    const list = map.get(folder) ?? []
    list.push(entry)
    map.set(folder, list)
  }
  return [...map.entries()].map(([folderName, folderEntries]) => ({
    folderName,
    byCategory: CATEGORY_ORDER
      .map((category) => ({ category, list: folderEntries.filter((e) => categoryOf(e) === category) }))
      .filter((g) => g.list.length > 0),
  }))
}

/** Archivos sin carpeta (relativePath vacío o de un solo segmento). */
function looseEntries(entries: readonly FileEntry[]): FileEntry[] {
  return entries.filter((entry) => folderOf(entry) === null)
}



type Category = 'image' | 'document' | 'video' | 'audio'
const CATEGORY_ORDER: readonly Category[] = ['image', 'document', 'video', 'audio']
const CATEGORY_META: Readonly<Record<Category, { name: string; icon: IconName }>> = {
  image: { name: 'Imágenes', icon: 'img' },
  document: { name: 'Documentos', icon: 'doc' },
  video: { name: 'Video', icon: 'video' },
  audio: { name: 'Audio', icon: 'audio' },
}

function categoryOf(entry: FileEntry): Category {
  switch (entry.detectedType.kind) {
    case 'image': return 'image'
    case 'video': return 'video'
    case 'audio': return 'audio'
    default: return 'document'
  }
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`
}

export interface FileQueueProps {
  entries: readonly FileEntry[]
  /** Quita un archivo de la cola (lo maneja App, dueño de entries). */
  onRemove?: (id: string) => void
  /** Vacía la cola entera. */
  onClear?: () => void
  /** Progreso del lote para el fondo animado: 0–1 corriendo, undefined en reposo. */
  onBatchActivity?: (progress: number | undefined) => void
  /** Archivos que el recorrido de carpetas no exploró por el techo de MAX_SCAN_FILES. */
  skippedByScan?: number
}

/** Un rechazo por cupo es siempre el mismo texto: se detecta por prefijo para agruparlos. */
const QUOTA_REASON_PREFIX = 'Límite de'

export function FileQueue({ entries, onRemove, onClear, onBatchActivity, skippedByScan = 0 }: FileQueueProps) {
  const ready = entries.filter((entry) => entry.state !== 'rejected')
  const allRejected = entries.filter((entry) => entry.state === 'rejected')
  // Los rechazos por cupo se colapsan en una fila resumen: 200 filas rojas idénticas son
  // ruido, no información (006 FR-004). Los demás conservan su fila, que sí es accionable.
  const overQuota = allRejected.filter((entry) => entry.rejectionReason?.startsWith(QUOTA_REASON_PREFIX))
  const rejected = allRejected.filter((entry) => !entry.rejectionReason?.startsWith(QUOTA_REASON_PREFIX))
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [rowOptions, setRowOptions] = useState<Record<string, RowOptions>>({})
  const [items, setItems] = useState<Record<string, BatchItem>>({})
  const [downloads, setDownloads] = useState<Record<string, RowDownload[]>>({})
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState(false)
  /** Archivos que se están reintentando de a uno, fuera de un lote. */
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [zipping, setZipping] = useState(false)
  const [zipPercent, setZipPercent] = useState(0)
  const [zipError, setZipError] = useState<string>()
  // Selectores de formato por carpeta+categoría: clave = "carpeta::categoría"
  const [folderSelection, setFolderSelection] = useState<Record<string, string>>({})
  const [folderZipping, setFolderZipping] = useState<Record<string, boolean>>({})
  const [folderZipPercent, setFolderZipPercent] = useState<Record<string, number>>({})
  const [folderZipError, setFolderZipError] = useState<Record<string, string>>({})
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  /** Resumen visible del último lote: listos / con error / cancelados (FR-016). */
  const [summary, setSummary] = useState<Announcement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const downloadsRef = useRef<Record<string, RowDownload[]>>({})
  // Resultados por archivo, acumulados entre corridas, para el ZIP "Descargar todo".
  // Se guardan como Blob y no como ArrayBuffer: el navegador respalda los blobs grandes en
  // disco, así que 200 resultados no viven en el heap (006 FR-006).
  const resultsRef = useRef<Record<string, { name: string; blob: Blob; relativePath?: string }[]>>({})

  useEffect(() => () => {
    abortRef.current?.abort()
    Object.values(downloadsRef.current).flat().forEach((d) => URL.revokeObjectURL(d.url))
  }, [])

  useEffect(() => { downloadsRef.current = downloads }, [downloads])

  const chosen = (entry: FileEntry): Choice | undefined => choicesFor(entry).find((choice) => choiceKey(choice) === selection[entry.id])
  const optionsOf = (entry: FileEntry): RowOptions => rowOptions[entry.id] ?? DEFAULT_ROW_OPTIONS
  const patchOptions = (id: string, patch: Partial<RowOptions>) =>
    setRowOptions((current) => ({ ...current, [id]: { ...(current[id] ?? DEFAULT_ROW_OPTIONS), ...patch } }))

  const pending = ready.filter((entry) => !chosen(entry))
  const convertible = ready.filter((entry) => chosen(entry))
  // Solo se (re)convierte lo que todavía no está listo: no se reprocesa lo ya convertido/compartido.
  const toConvert = convertible.filter((entry) => items[entry.id]?.state !== 'completed')
  const alreadyDone = convertible.length - toConvert.length

  const updateItem = (id: string, patch: Partial<BatchItem>) => setItems((current) => ({ ...current, [id]: { ...current[id], ...patch } as BatchItem }))

  /**
   * Marca la fila como fallida clasificando la causa: de ahí sale si se ofrece "Reintentar"
   * (FR-013). Ofrecerlo en un fallo determinístico sería prometer algo que no va a pasar.
   */
  const failItem = (id: string, message: string) => {
    const rowError = makeRowError(message)
    updateItem(id, { state: 'error', error: rowError.message, errorClass: rowError.errorClass })
  }

  /** Olvida el resultado y la descarga de un archivo (p. ej. al cambiar su formato destino). */
  const forgetResult = (id: string) => {
    delete resultsRef.current[id]
    setItems((current) => { if (!current[id]) return current; const next = { ...current }; delete next[id]; return next })
    setDownloads((current) => { if (!current[id]) return current; current[id].forEach((download) => URL.revokeObjectURL(download.url)); const next = { ...current }; delete next[id]; return next })
    setDownloadedIds((current) => { if (!current[id]) return current; const next = { ...current }; delete next[id]; return next })
  }

  const registerResults = (entry: FileEntry, results: ConversionResult[]) => {
    // Un único Blob por resultado: alimenta la descarga individual Y el ZIP. El ArrayBuffer
    // que llegó del worker queda sin referencias y es elegible para GC en el acto.
    const blobs = results.map((result) => ({ name: result.name, blob: new Blob([result.buffer], { type: result.mime }), relativePath: entry.relativePath }))
    resultsRef.current[entry.id] = blobs
    setDownloads((current) => ({ ...current, [entry.id]: blobs.map(({ blob, name }) => ({ url: URL.createObjectURL(blob), name })) }))
  }

  /** Entradas del ZIP: todo lo convertido que siga en la cola, en el orden de la cola. */
  const packagedEntries = () => {
    const present = new Set(entries.map((entry) => entry.id))
    return Object.entries(resultsRef.current)
      .filter(([id]) => present.has(id))
      .flatMap(([, list]) => list)
  }

  /**
   * Se empaqueta al hacer clic, no al terminar el lote: `showSaveFilePicker` exige el gesto
   * del usuario, y así no se arma un ZIP que nadie descarga (FR-010).
   */
  const downloadAll = async () => {
    const packaged = packagedEntries()
    if (!packaged.length || zipping) return
    setZipping(true)
    setZipPercent(0)
    setZipError(undefined)
    try {
      const delivery = await saveZip(packaged, undefined, setZipPercent)
      if (delivery.kind === 'blob') {
        const url = URL.createObjectURL(delivery.blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'convertitodo.zip'
        anchor.click()
        // El navegador ya tomó los bytes; liberar la referencia en el siguiente tick.
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      playSound('zip')
    } catch (thrown) {
      // Que el empaquetado falle nunca puede dejar la UI inutilizable: las descargas
      // individuales siguen disponibles (FR-009).
      if (!(thrown instanceof DOMException && thrown.name === 'AbortError')) {
        setZipError(thrown instanceof Error ? thrown.message : 'No se pudo armar el ZIP.')
      }
    } finally {
      setZipping(false)
    }
  }

  /** Clave para el selector de carpeta+categoría */
  const folderCatKey = (folderName: string, category: Category) => `${folderName}::${category}`

  /** Aplica un choiceKey a todos los archivos del grupo carpeta+categoría (olvida resultados anteriores). */
  const applyFolderFormat = (folderName: string, category: Category, value: string) => {
    const affected = ready.filter((e) => folderOf(e) === folderName && categoryOf(e) === category)
    if (!affected.length) return
    playSound('toggle')
    setFolderSelection((prev) => ({ ...prev, [folderCatKey(folderName, category)]: value }))
    setSelection((prev) => {
      const next = { ...prev }
      for (const entry of affected) next[entry.id] = value
      return next
    })
    for (const entry of affected) forgetResult(entry.id)
  }

  /** Descarga un ZIP solo con los resultados de una carpeta+categoría. */
  const downloadFolderZip = async (folderName: string, folderEntries: FileEntry[]) => {
    const key = folderName
    const present = new Set(folderEntries.map((e) => e.id))
    const packaged = Object.entries(resultsRef.current)
      .filter(([id]) => present.has(id))
      .flatMap(([, list]) => list)
    if (!packaged.length || folderZipping[key]) return
    setFolderZipping((prev) => ({ ...prev, [key]: true }))
    setFolderZipPercent((prev) => ({ ...prev, [key]: 0 }))
    setFolderZipError((prev) => { const next = { ...prev }; delete next[key]; return next })
    try {
      const delivery = await saveZip(packaged, undefined, (pct) =>
        setFolderZipPercent((prev) => ({ ...prev, [key]: pct })))
      if (delivery.kind === 'blob') {
        const url = URL.createObjectURL(delivery.blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${folderName}.zip`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      playSound('zip')
    } catch (thrown) {
      if (!(thrown instanceof DOMException && thrown.name === 'AbortError')) {
        setFolderZipError((prev) => ({ ...prev, [key]: thrown instanceof Error ? thrown.message : 'No se pudo armar el ZIP.' }))
      }
    } finally {
      setFolderZipping((prev) => ({ ...prev, [key]: false }))
    }
  }

  /**
   * Convierte UN archivo y refleja el desenlace en su fila. Es el único camino de conversión
   * individual: lo usan el lote y el reintento, así que reintentar no puede divergir (FR-014).
   */
  const convertEntry = async (entry: FileEntry, signal: AbortSignal): Promise<Outcome> => {
    const choice = chosen(entry)
    if (!choice) return 'cancelled'
    if (signal.aborted) { updateItem(entry.id, { state: 'cancelled' }); return 'cancelled' }
    if (exceedsFileLimit(entry.file, choice.converter)) { failItem(entry.id, fileLimitMessage(entry.file, choice.converter)); return 'error' }
    updateItem(entry.id, { state: 'converting', percent: 0 })
    try {
      const options = await optionsFor(choice, entry, optionsOf(entry))
      const results = await convertWatched(choice, entry.file, (progress) => updateItem(entry.id, { percent: progress.percent }), options, signal)
      registerResults(entry, results)
      updateItem(entry.id, { state: 'completed', percent: 100, error: undefined, errorClass: undefined })
      return 'done'
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === 'AbortError') { updateItem(entry.id, { state: 'cancelled' }); return 'cancelled' }
      failItem(entry.id, thrown instanceof Error ? thrown.message : 'La conversión falló por un error inesperado.')
      return 'error'
    }
  }

  /**
   * Reintenta un solo archivo (FR-014). Vuelve a leer el `File` original —los ArrayBuffer de
   * entrada quedan detached al transferirse al worker— y no toca la cola ni los resultados de
   * los demás. Sin sonido: el de fin de cola es por lote, nunca por archivo (FR-029).
   */
  const retryOne = async (entry: FileEntry) => {
    if (running || retrying[entry.id]) return
    setRetrying((current) => ({ ...current, [entry.id]: true }))
    const controller = new AbortController()
    try {
      await convertEntry(entry, controller.signal)
    } finally {
      setRetrying((current) => { const next = { ...current }; delete next[entry.id]; return next })
    }
  }

  const convertAll = async () => {
    if (!toConvert.length) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setAnnouncement(null)
    setSummary(null)
    setZipError(undefined)
    // Preservar lo ya convertido: solo se limpian y encolan los pendientes.
    setDownloads((current) => {
      const next = { ...current }
      for (const entry of toConvert) { next[entry.id]?.forEach((d) => URL.revokeObjectURL(d.url)); delete next[entry.id] }
      return next
    })
    setDownloadedIds((current) => { const next = { ...current }; for (const entry of toConvert) delete next[entry.id]; return next })
    for (const entry of toConvert) delete resultsRef.current[entry.id]
    setItems((current) => { const next = { ...current }; for (const entry of toConvert) next[entry.id] = { state: 'queued' }; return next })
    // Contadores del lote para el sonido y el anuncio consolidados (FR-029c, FR-043)
    let doneCount = 0
    let errorCount = 0
    let cancelledCount = 0

    // Todo el cuerpo va en try/finally: pase lo que pase, el lote deja de estar "corriendo".
    // Antes `setRunning(false)` estaba en el camino feliz y un fallo posterior dejaba la UI
    // trabada con "Cancelar lote" para siempre (006 FR-009).
    try {
    // Los conversores de lote (p. ej. varias imágenes a un PDF) agrupan los archivos que
    // comparten exactamente el mismo destino; el resto se convierte archivo por archivo.
    const groups = new Map<string, { choice: Choice; entries: FileEntry[] }>()
    const singles: FileEntry[] = []
    for (const entry of toConvert) {
      const choice = chosen(entry)
      if (!choice) continue
      if (!choice.converter.convertMany) { singles.push(entry); continue }
      const key = choiceKey(choice)
      const group = groups.get(key) ?? { choice, entries: [] }
      group.entries.push(entry)
      groups.set(key, group)
    }

    for (const { choice, entries: grouped } of groups.values()) {
      const oversized = grouped.find((entry) => exceedsFileLimit(entry.file, choice.converter))
      if (oversized) { failItem(oversized.id, fileLimitMessage(oversized.file, choice.converter)); errorCount += 1; continue }
      grouped.forEach((entry) => updateItem(entry.id, { state: 'converting', percent: 0 }))
      try {
        const options = await optionsFor(choice, grouped[0], optionsOf(grouped[0]))
        const results = await choice.converter.convertMany!(grouped.map((entry) => entry.file), (progress) => grouped.forEach((entry) => updateItem(entry.id, { percent: progress.percent })), options, controller.signal)
        registerResults(grouped[0], results)
        grouped.forEach((entry) => updateItem(entry.id, { state: 'completed', percent: 100, error: undefined, errorClass: undefined }))
        doneCount += grouped.length
      } catch (thrown) {
        const cancelled = thrown instanceof DOMException && thrown.name === 'AbortError'
        const message = thrown instanceof Error ? thrown.message : 'Falló la conversión conjunta.'
        grouped.forEach((entry) => { if (cancelled) updateItem(entry.id, { state: 'cancelled' }); else failItem(entry.id, message) })
        if (cancelled) cancelledCount += grouped.length
        else errorCount += grouped.length
      }
    }

    // Dos grupos con su propio tope (FR-017): audio/video de a 1, el resto de a 2. Un solo MP3
    // ya no baja el lote entero a concurrencia 1.
    const outcomes = await runPartitioned(singles.map((entry) => ({
      limit: concurrencyForConverter(chosen(entry)!.converter),
      run: () => convertEntry(entry, controller.signal),
    })), controller.signal)

    for (const outcome of outcomes) {
      const value = outcome.status === 'fulfilled' ? outcome.value : 'cancelled'
      if (value === 'done') doneCount += 1
      else if (value === 'error') errorCount += 1
      else cancelledCount += 1
    }
    } finally {
      setRunning(false)
    }

    // Fin de cola: UN solo sonido para todo el lote, nunca por archivo (FR-029).
    // Cancelar todo no es un logro: sin terminados ni errores no suena nada.
    if (errorCount > 0) playSound('queue-done-errors')
    else if (doneCount > 0) playSound('queue-done-ok')
    // Anuncio consolidado por lote para lectores de pantalla (FR-043) con el resumen
    // completo del lote: listos, con error y cancelados (006 FR-016).
    if (doneCount > 0 || errorCount > 0 || cancelledCount > 0) setAnnouncement({ done: doneCount, failed: errorCount, cancelled: cancelledCount })
    setSummary({ done: doneCount, failed: errorCount, cancelled: cancelledCount })
  }

  const tracked = convertible.map((entry) => items[entry.id]).filter((item): item is BatchItem => Boolean(item))
  const globalPercent = tracked.length ? Math.round(tracked.reduce((sum, item) => sum + (item.state === 'completed' ? 100 : item.percent ?? 0), 0) / tracked.length) : undefined
  const doneTotal = Object.values(items).filter((item) => item.state === 'completed').length

  useEffect(() => {
    onBatchActivity?.(running ? (globalPercent ?? 0) / 100 : undefined)
  }, [running, globalPercent, onBatchActivity])

  // Toolbar: "N archivos · M carpetas" como el mockup
  const folderCount = new Set(ready.map((entry) => entry.relativePath?.split('/')[0]).filter(Boolean)).size
  const countLabel = `${ready.length} ${ready.length === 1 ? 'archivo' : 'archivos'}${folderCount ? ` · ${folderCount} ${folderCount === 1 ? 'carpeta' : 'carpetas'}` : ''}`

  // Archivos sueltos (sin carpeta) agrupados por categoría — comportamiento original
  const loose = looseEntries(ready)
  const groupsByCategory = CATEGORY_ORDER
    .map((category) => ({ category, meta: CATEGORY_META[category], list: loose.filter((entry) => categoryOf(entry) === category) }))
    .filter((group) => group.list.length > 0)

  // Archivos con carpeta — agrupados por carpeta y luego por categoría
  const folderGroups = buildFolderGroups(ready)

  const renderRow = (entry: FileEntry) => {
    const item = items[entry.id]
    const choice = chosen(entry)
    const choices = choicesFor(entry)
    const many = new Set(choices.map((c) => c.target)).size !== choices.length
    const options = optionsOf(entry)
    const state = item?.state
    const rowDownloads = downloads[entry.id] ?? []
    const meta = CATEGORY_META[categoryOf(entry)]
    const showImageOptions = choice?.converter.id === 'image-convert'
    const showMp4Options = choice?.converter.id === 'mp3-to-mp4'

    return (
      <div className="ct-row" key={entry.id} data-state={state ?? 'pending'}>
        {state === 'completed' && <span className="ct-row-sweep" aria-hidden="true" />}
        <span className="ct-row-glyph" aria-hidden="true">
          <Icon name={meta.icon} size={17} />
          {state === 'completed' && <span className="ct-row-glow" />}
        </span>

        <div className="ct-row-main">
          <div className="ct-row-name">{entry.name}</div>
          <div className="ct-row-sub">
            {entry.detectedType.extension.toUpperCase()}
            {choice ? ` → ${choice.target.toUpperCase()}` : ''} · {fmtSize(entry.sizeBytes)}
          </div>
        </div>

        <div className="ct-row-side">
          {/* Selector por archivo (FR-023b); el nombre accesible es el archivo */}
          <span className="ct-select-wrap">
            <select
              className="ct-select"
              aria-label={entry.name}
              value={selection[entry.id] ?? ''}
              onChange={(event) => {
                if (event.target.value) playSound('toggle')
                setSelection((current) => ({ ...current, [entry.id]: event.target.value }))
                // Cambiar el destino de un archivo ya convertido lo vuelve pendiente de nuevo.
                forgetResult(entry.id)
              }}
              disabled={running}
            >
              <option value="">Elegí un formato destino</option>
              {choices.map((c) => <option key={choiceKey(c)} value={choiceKey(c)}>{choiceLabel(c, many)}</option>)}
            </select>
            <Icon name="chev" size={14} className="ct-select-chev" />
          </span>

          {!choice && !state && <span role="note" className="ct-note">sin formato destino: no se convertirá</span>}

          {(state === undefined || state === 'queued') && choice && (
            <span className="ct-pill ct-pill-pending"><span className="ct-pill-dot" aria-hidden="true" />Pendiente</span>
          )}

          {state === 'converting' && (
            <>
              <span className="ct-progress" role="progressbar" aria-label={`Progreso de ${entry.name}`} aria-valuenow={item?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <span className="ct-progress-fill" style={{ width: `${item?.percent ?? 0}%` }} />
              </span>
              <span className="ct-progress-pct">{Math.round(item?.percent ?? 0)}%</span>
            </>
          )}

          {state === 'completed' && (
            <>
              <span className="ct-pill ct-pill-done">
                <svg viewBox="0 0 24 24" width={13} height={13} className="ct-icn ct-check-draw" aria-hidden="true"><use href="#i-check" /></svg>
                {downloadedIds[entry.id] ? 'Descargado' : 'Listo'}
              </span>
              {rowDownloads.map((download) => (
                <a
                  key={download.url}
                  className="ct-btn ct-btn-dark ct-btn-sm"
                  href={download.url}
                  download={download.name}
                  aria-label={`Descargar ${download.name}`}
                  onClick={() => setDownloadedIds((current) => ({ ...current, [entry.id]: true }))}
                >
                  <Icon name="download" size={14} />
                  Descargar
                </a>
              ))}
            </>
          )}

          {state === 'error' && (
            <span className="ct-pill ct-pill-error"><span className="ct-pill-dot" aria-hidden="true" />Error</span>
          )}

          {/* Reintentar solo en fallos transitorios: en un determinístico daría lo mismo (FR-013) */}
          {state === 'error' && item?.errorClass === 'transient' && !running && (
            <button
              type="button"
              className="ct-btn ct-btn-outline ct-btn-sm"
              aria-label={`Reintentar ${entry.name}`}
              disabled={retrying[entry.id]}
              onClick={() => { void retryOne(entry) }}
            >
              <Icon name="refresh" size={14} />
              {retrying[entry.id] ? 'Reintentando…' : 'Reintentar'}
            </button>
          )}

          {state === 'cancelled' && (
            <span className="ct-pill ct-pill-cancelled"><span className="ct-pill-dot" aria-hidden="true" />Cancelado</span>
          )}

          {showImageOptions && !running && (
            <button
              type="button"
              className="ct-options-toggle"
              aria-expanded={options.optionsOpen}
              onClick={() => patchOptions(entry.id, { optionsOpen: !options.optionsOpen })}
            >
              Opciones de imagen
              <Icon name="chev" size={12} />
            </button>
          )}

          {onRemove && !running && state !== 'converting' && (
            <button type="button" className="ct-btn-icon" title="Quitar" aria-label={`Quitar ${entry.name}`} onClick={() => onRemove(entry.id)}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Causa concreta del error, visible y accesible (FR-019, FR-043b) */}
        {state === 'error' && item?.error && <p role="alert" className="ct-row-error-cause">{item.error}</p>}

        {showImageOptions && options.optionsOpen && (
          <div className="ct-row-options">
            <label>Calidad {options.quality}%
              <input aria-label="Calidad" type="range" min="1" max="100" value={options.quality} onChange={(event) => patchOptions(entry.id, { quality: Number(event.target.value) })} />
            </label>
            <label>Ancho máximo (px)
              <input aria-label="Ancho máximo" type="number" min="1" value={options.maxWidth ?? ''} onChange={(event) => patchOptions(entry.id, { maxWidth: event.target.value ? Number(event.target.value) : undefined })} />
            </label>
            {choice?.target === 'jpg' && <span className="ct-note">La transparencia se aplana sobre fondo blanco al convertir a JPG.</span>}
          </div>
        )}

        {/* MP3→MP4: waveform automático por defecto, portada opcional (FR-028/FR-028b) */}
        {showMp4Options && (
          <div className="ct-row-options">
            <label><input type="radio" name={`visual-${entry.id}`} checked={options.visual === 'waveform'} onChange={() => patchOptions(entry.id, { visual: 'waveform' })} />Generar waveform</label>
            <label><input type="radio" name={`visual-${entry.id}`} checked={options.visual === 'cover'} onChange={() => patchOptions(entry.id, { visual: 'cover' })} />Usar portada</label>
            {options.visual === 'cover' && (
              <label>Imagen de portada
                <input aria-label="Imagen de portada" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => patchOptions(entry.id, { cover: event.target.files?.[0] })} />
              </label>
            )}
            <span className="ct-note">{options.visual === 'waveform' ? 'Se usará un waveform generado automáticamente.' : 'Se usará tu imagen como fondo del video.'}</span>
          </div>
        )}
      </div>
    )
  }

  /**
   * Renderiza un grupo de categoría (imagen/doc/video/audio) dentro de una carpeta.
   * Incluye un selector de formato que aplica a todos los archivos del grupo.
   */
  const renderFolderCategoryGroup = (folderName: string, category: Category, list: FileEntry[]) => {
    const meta = CATEGORY_META[category]
    const key = folderCatKey(folderName, category)
    const commonChoices: readonly CommonChoice[] = getCommonTargets(list)
    const currentValue = folderSelection[key] ?? ''
    const limitations = [...new Set(list.map((entry) => chosen(entry)?.converter.limitation).filter(Boolean))]
    const manyConverters = new Set(commonChoices.map((c) => c.target)).size !== commonChoices.length

    return (
      <div className="ct-group ct-group-folder-category" key={`${folderName}::${category}`}>
        <div className="ct-group-head">
          <div className="ct-group-id">
            <span className="ct-group-glyph" aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
            <div>
              <div className="ct-group-name">
                {meta.name}
                {limitations.length > 0 && (
                  <span className="ct-badge-fidelity" title={limitations.join(' ')}>
                    <Icon name="info" size={12} />
                    Fidelidad parcial
                  </span>
                )}
              </div>
              <div className="ct-group-count">{list.length} {list.length === 1 ? 'archivo' : 'archivos'}</div>
            </div>
          </div>

          {/* Selector de formato para toda la categoría dentro de la carpeta */}
          {commonChoices.length > 0 && (
            <span className="ct-select-wrap ct-folder-format-select">
              <select
                className="ct-select"
                aria-label={`Formato para todas las ${meta.name.toLowerCase()} de ${folderName}`}
                value={currentValue}
                onChange={(event) => applyFolderFormat(folderName, category, event.target.value)}
                disabled={running}
              >
                <option value="">Aplicar formato a todas…</option>
                {commonChoices.map((c) => {
                  const ck = choiceKey(c)
                  return <option key={ck} value={ck}>{manyConverters ? `${c.target.toUpperCase()} — ${c.converter.label}` : c.target.toUpperCase()}</option>
                })}
              </select>
              <Icon name="chev" size={14} className="ct-select-chev" />
            </span>
          )}
          {commonChoices.length === 0 && (
            <span role="note" className="ct-note"><Icon name="info" size={13} />Sin formato común</span>
          )}
        </div>

        {limitations.map((limitation) => (
          <div className="ct-note-block" key={limitation}>
            <p role="note" className="ct-note"><Icon name="info" size={14} />{limitation}</p>
          </div>
        ))}
        {list.map(renderRow)}
      </div>
    )
  }

  /** Renderiza una carpeta completa: nombre + ZIP inline + sub-grupos por categoría. */
  const renderFolderGroup = (group: FolderGroup) => {
    const allFolderEntries = group.byCategory.flatMap((g) => g.list)
    const folderDoneTotal = allFolderEntries.filter((e) => items[e.id]?.state === 'completed').length
    const isZipping = folderZipping[group.folderName] ?? false
    const zipPct = folderZipPercent[group.folderName] ?? 0
    const zipErr = folderZipError[group.folderName]

    return (
      <div className="ct-folder-group" key={group.folderName}>
        <div className="ct-folder-head">
          <span className="ct-folder-icon" aria-hidden="true"><Icon name="folder" size={18} /></span>
          <span className="ct-folder-name">{group.folderName}</span>
          <span className="ct-folder-count">{allFolderEntries.length} {allFolderEntries.length === 1 ? 'archivo' : 'archivos'}</span>

          {folderDoneTotal > 0 && !running && (
            <button
              type="button"
              className="ct-btn ct-btn-dark ct-btn-sm ct-folder-zip-btn"
              onClick={() => { void downloadFolderZip(group.folderName, allFolderEntries) }}
              disabled={isZipping}
              aria-label={`Descargar ${group.folderName} como ZIP`}
            >
              <Icon name="zip" size={14} />
              {isZipping ? `${zipPct}%` : 'Descargar ZIP'}
            </button>
          )}
        </div>

        {zipErr && (
          <p role="alert" className="ct-row-error-cause">{zipErr} Podés descargar los archivos de a uno.</p>
        )}

        {group.byCategory.map((catGroup) =>
          renderFolderCategoryGroup(group.folderName, catGroup.category, catGroup.list)
        )}
      </div>
    )
  }

  return (
    <section aria-label="Cola de archivos" className="ct-queue">
      <LiveRegion announcement={announcement} />

      {ready.length > 0 && (
        <div className="ct-queue-toolbar">
          <span className="ct-queue-count">{countLabel}</span>
          <div className="ct-queue-actions">
            {onClear && (
              <button type="button" className="ct-btn ct-btn-outline" onClick={onClear} disabled={running}>
                Vaciar
              </button>
            )}
            {!running && (
              <button type="button" className="ct-btn ct-btn-dark" onClick={() => { void convertAll() }} disabled={!toConvert.length}>
                <Icon name="refresh" size={15} />
                {alreadyDone > 0 ? `Convertir pendientes (${toConvert.length})` : 'Convertir todos'}
              </button>
            )}
            {running && (
              <>
                <span className="ct-progress" role="progressbar" aria-label="Progreso del lote" aria-valuenow={globalPercent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                  <span className="ct-progress-fill" style={{ width: `${globalPercent ?? 0}%` }} />
                </span>
                <span className="ct-progress-pct">{globalPercent ?? 0}%</span>
                <button type="button" className="ct-btn ct-btn-outline" onClick={() => abortRef.current?.abort()}>Cancelar lote</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Resumen del lote terminado: listos / con error / cancelados (FR-016) */}
      {summary && !running && (
        <p className="ct-note ct-batch-summary">
          <Icon name="info" size={14} />
          Lote terminado: {announcementText(summary)}.
        </p>
      )}

      {pending.length > 0 && ready.length > 0 && (
        <p role="note" className="ct-note">
          <Icon name="info" size={14} />
          {pending.length} archivo(s) sin formato destino elegido: se omitirán al convertir.
        </p>
      )}

      {/* Carpetas: cada carpeta con sus subcategorías y selector de formato masivo */}
      {folderGroups.map(renderFolderGroup)}

      {/* Archivos sueltos (sin carpeta): comportamiento original por categoría */}
      {groupsByCategory.map(({ category, meta, list }) => {
        const limitations = [...new Set(list.map((entry) => chosen(entry)?.converter.limitation).filter(Boolean))]
        return (
          <div className="ct-group" key={category}>
            <div className="ct-group-head">
              <div className="ct-group-id">
                <span className="ct-group-glyph" aria-hidden="true"><Icon name={meta.icon} size={16} /></span>
                <div>
                  <div className="ct-group-name">
                    {meta.name}
                    {limitations.length > 0 && (
                      <span className="ct-badge-fidelity" title={limitations.join(' ')}>
                        <Icon name="info" size={12} />
                        Fidelidad parcial
                      </span>
                    )}
                  </div>
                  <div className="ct-group-count">{list.length} {list.length === 1 ? 'archivo' : 'archivos'}</div>
                </div>
              </div>
            </div>
            {/* Aviso de fidelidad ANTES de convertir (FR-026/FR-027) */}
            {limitations.map((limitation) => (
              <div className="ct-note-block" key={limitation}>
                <p role="note" className="ct-note"><Icon name="info" size={14} />{limitation}</p>
              </div>
            ))}
            {list.map(renderRow)}
          </div>
        )
      })}

      {/* Rechazos por cupo y por techo de exploración: una sola fila resumen (006 FR-004) */}
      {(overQuota.length > 0 || skippedByScan > 0) && (
        <div className="ct-group ct-group-unsupported">
          <div className="ct-group-head">
            <div className="ct-group-id">
              <span className="ct-group-glyph" aria-hidden="true"><Icon name="info" size={16} /></span>
              <div>
                <div className="ct-group-name">No entraron en la cola</div>
                <div className="ct-group-count" role="alert">
                  {overQuota.length > 0 && `${overQuota.length} ${overQuota.length === 1 ? 'archivo superó' : 'archivos superaron'} el tope de ${MAX_BATCH_FILES} de la cola.`}
                  {overQuota.length > 0 && skippedByScan > 0 && ' '}
                  {skippedByScan > 0 && `${skippedByScan} ${skippedByScan === 1 ? 'archivo quedó' : 'archivos quedaron'} sin explorar: la carpeta supera los ${MAX_SCAN_FILES} archivos.`}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vista agrupada de rechazos (FR-012): sin selector, sin convertir, sin sonidos */}
      {rejected.length > 0 && (
        <div className="ct-group ct-group-unsupported">
          <div className="ct-group-head">
            <div className="ct-group-id">
              <span className="ct-group-glyph" aria-hidden="true"><Icon name="alert" size={16} /></span>
              <div>
                <div className="ct-group-name">No soportados</div>
                <div className="ct-group-count">{rejected.length} {rejected.length === 1 ? 'archivo' : 'archivos'}</div>
              </div>
            </div>
          </div>
          {rejected.map((entry) => (
            <div className="ct-row" key={entry.id}>
              <span className="ct-row-glyph" aria-hidden="true"><Icon name="alert" size={17} /></span>
              <div className="ct-row-main">
                <div className="ct-row-name">{entry.name}</div>
                <div className="ct-reject-reason" role="alert">{entry.rejectionReason}</div>
              </div>
              {onRemove && (
                <button type="button" className="ct-btn-icon" title="Quitar" aria-label={`Quitar ${entry.name}`} onClick={() => onRemove(entry.id)}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Estado interno por archivo, solo para tecnologías asistivas y tests */}
      {tracked.length > 0 && (
        <ul aria-label="Progreso del lote" className="ct-visually-hidden">
          {convertible.map((entry) => { const item = items[entry.id]; return item ? <li key={entry.id}>{entry.name}: {item.state}</li> : null })}
        </ul>
      )}

      {doneTotal > 0 && !running && (
        <div className="ct-zipbar" role="region" aria-label="Descarga de todos los archivos">
          <div className="ct-zipbar-info">
            <span className="ct-zipbar-glyph" aria-hidden="true"><Icon name="zip" size={20} /></span>
            <div>
              <div className="ct-zipbar-title">Descargar todo</div>
              <div className="ct-zipbar-sub">
                {zipping
                  ? `Empaquetando… ${zipPercent}%`
                  : `${doneTotal} ${doneTotal === 1 ? 'listo' : 'listos'} · empaquetados en tu navegador`}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="ct-zipbar-link"
            onClick={() => { void downloadAll() }}
            disabled={zipping}
          >
            <Icon name="download" size={16} />
            {zipping ? 'Empaquetando…' : 'Descargar ZIP'}
          </button>
        </div>
      )}

      {/* El ZIP puede fallar sin que eso invalide las descargas individuales (FR-009). */}
      {zipError && (
        <p role="alert" className="ct-row-error-cause">
          {zipError} Podés seguir descargando los archivos de a uno.
        </p>
      )}
    </section>
  )
}
