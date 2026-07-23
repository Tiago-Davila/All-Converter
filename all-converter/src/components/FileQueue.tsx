/**
 * FileQueue: cola por lotes con la identidad visual del mockup (DEP-001).
 * Agrupa por categoría (Imágenes / Documentos / Video / Audio / No soportados),
 * cada archivo elige su destino (001 FR-023b) y los estados usan color + forma
 * + texto (FR-015/FR-044). El sonido de fin de cola suena UNA vez por lote,
 * nunca por archivo (FR-029/FR-029b).
 */
import { useEffect, useRef, useState } from 'react'
import type { ConversionResult, Converter, FileEntry } from '../converters/types'
import { getAvailableConverters, getConverterTargets } from '../converters/registry'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { concurrencyForConverter, runWithConcurrency } from '../lib/job-scheduler'
import { createZip } from '../lib/zip'
import { Icon, type IconName } from '../ui/components/icons'
import { LiveRegion, type Announcement } from '../ui/a11y/LiveRegion'
import { playSound } from '../ui/sound/player'

interface BatchItem { state: 'queued' | 'converting' | 'completed' | 'error' | 'cancelled'; percent?: number; error?: string }
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

// ── Categorías (mockup: Imágenes / Documentos / Video / Audio) ───────────────

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
}

export function FileQueue({ entries, onRemove, onClear, onBatchActivity }: FileQueueProps) {
  const ready = entries.filter((entry) => entry.state !== 'rejected')
  const rejected = entries.filter((entry) => entry.state === 'rejected')
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [rowOptions, setRowOptions] = useState<Record<string, RowOptions>>({})
  const [items, setItems] = useState<Record<string, BatchItem>>({})
  const [downloads, setDownloads] = useState<Record<string, RowDownload[]>>({})
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState(false)
  const [zipUrl, setZipUrl] = useState<string>()
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const zipUrlRef = useRef<string | undefined>(undefined)
  const downloadsRef = useRef<Record<string, RowDownload[]>>({})
  // Resultados crudos por archivo, acumulados entre corridas, para el ZIP "Descargar todo".
  const resultsRef = useRef<Record<string, { name: string; buffer: ArrayBuffer; relativePath?: string }[]>>({})

  useEffect(() => () => {
    abortRef.current?.abort()
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current)
    Object.values(downloadsRef.current).flat().forEach((d) => URL.revokeObjectURL(d.url))
  }, [])

  useEffect(() => { zipUrlRef.current = zipUrl }, [zipUrl])
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

  /** Olvida el resultado y la descarga de un archivo (p. ej. al cambiar su formato destino). */
  const forgetResult = (id: string) => {
    delete resultsRef.current[id]
    setItems((current) => { if (!current[id]) return current; const next = { ...current }; delete next[id]; return next })
    setDownloads((current) => { if (!current[id]) return current; current[id].forEach((download) => URL.revokeObjectURL(download.url)); const next = { ...current }; delete next[id]; return next })
    setDownloadedIds((current) => { if (!current[id]) return current; const next = { ...current }; delete next[id]; return next })
  }

  const registerResults = (entry: FileEntry, results: ConversionResult[]) => {
    resultsRef.current[entry.id] = results.map((result) => ({ name: result.name, buffer: result.buffer, relativePath: entry.relativePath }))
    const rows = results.map((result) => ({ url: URL.createObjectURL(new Blob([result.buffer], { type: result.mime })), name: result.name }))
    setDownloads((current) => ({ ...current, [entry.id]: rows }))
  }

  const convertAll = async () => {
    if (!toConvert.length) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setAnnouncement(null)
    setZipUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return undefined })
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
      if (oversized) { updateItem(oversized.id, { state: 'error', error: fileLimitMessage(oversized.file, choice.converter) }); errorCount += 1; continue }
      grouped.forEach((entry) => updateItem(entry.id, { state: 'converting', percent: 0 }))
      try {
        const options = await optionsFor(choice, grouped[0], optionsOf(grouped[0]))
        const results = await choice.converter.convertMany!(grouped.map((entry) => entry.file), (progress) => grouped.forEach((entry) => updateItem(entry.id, { percent: progress.percent })), options, controller.signal)
        registerResults(grouped[0], results)
        grouped.forEach((entry) => updateItem(entry.id, { state: 'completed', percent: 100 }))
        doneCount += grouped.length
      } catch (thrown) {
        const cancelled = thrown instanceof DOMException && thrown.name === 'AbortError'
        grouped.forEach((entry) => updateItem(entry.id, { state: cancelled ? 'cancelled' : 'error', error: thrown instanceof Error ? thrown.message : 'Falló la conversión conjunta.' }))
        if (!cancelled) errorCount += grouped.length
      }
    }

    const concurrency = singles.reduce((lowest, entry) => Math.min(lowest, concurrencyForConverter(chosen(entry)!.converter)), 2)
    await runWithConcurrency(singles.map((entry) => async () => {
      const choice = chosen(entry)!
      if (controller.signal.aborted) { updateItem(entry.id, { state: 'cancelled' }); return }
      if (exceedsFileLimit(entry.file, choice.converter)) { updateItem(entry.id, { state: 'error', error: fileLimitMessage(entry.file, choice.converter) }); errorCount += 1; return }
      updateItem(entry.id, { state: 'converting', percent: 0 })
      try {
        const options = await optionsFor(choice, entry, optionsOf(entry))
        const results = await choice.converter.convert(entry.file, (progress) => updateItem(entry.id, { percent: progress.percent }), options, controller.signal)
        registerResults(entry, results)
        updateItem(entry.id, { state: 'completed', percent: 100 })
        doneCount += 1
      } catch (thrown) {
        if (thrown instanceof DOMException && thrown.name === 'AbortError') updateItem(entry.id, { state: 'cancelled' })
        else { updateItem(entry.id, { state: 'error', error: thrown instanceof Error ? thrown.message : 'La conversión falló por un error inesperado.' }); errorCount += 1 }
      }
    }), singles.length ? concurrency : 2, controller.signal)

    // El ZIP incluye TODO lo convertido hasta ahora (corridas previas + esta), no solo este lote.
    const packaged = Object.entries(resultsRef.current)
      .filter(([id]) => entries.some((entry) => entry.id === id))
      .flatMap(([, list]) => list)
    if (packaged.length) {
      const buffer = await createZip(packaged, controller.signal)
      setZipUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/zip' })))
    }
    setRunning(false)

    // Fin de cola: UN solo sonido para todo el lote, nunca por archivo (FR-029).
    // Cancelar todo no es un logro: sin terminados ni errores no suena nada.
    if (errorCount > 0) playSound('queue-done-errors')
    else if (doneCount > 0) playSound('queue-done-ok')
    // Anuncio consolidado por lote para lectores de pantalla (FR-043)
    if (doneCount > 0 || errorCount > 0) setAnnouncement({ done: doneCount, failed: errorCount })
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

  const groupsByCategory = CATEGORY_ORDER
    .map((category) => ({ category, meta: CATEGORY_META[category], list: ready.filter((entry) => categoryOf(entry) === category) }))
    .filter((group) => group.list.length > 0)

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

      {pending.length > 0 && ready.length > 0 && (
        <p role="note" className="ct-note">
          <Icon name="info" size={14} />
          {pending.length} archivo(s) sin formato destino elegido: se omitirán al convertir.
        </p>
      )}

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

      {zipUrl && (
        <div className="ct-zipbar" role="region" aria-label="Descarga de todos los archivos">
          <div className="ct-zipbar-info">
            <span className="ct-zipbar-glyph" aria-hidden="true"><Icon name="zip" size={20} /></span>
            <div>
              <div className="ct-zipbar-title">Descargar todo</div>
              <div className="ct-zipbar-sub">{doneTotal} {doneTotal === 1 ? 'listo' : 'listos'} · empaquetados en tu navegador</div>
            </div>
          </div>
          <a className="ct-zipbar-link" href={zipUrl} download="convertitodo.zip" onClick={() => playSound('zip')}>
            <Icon name="download" size={16} />
            Descargar ZIP
          </a>
        </div>
      )}
    </section>
  )
}
