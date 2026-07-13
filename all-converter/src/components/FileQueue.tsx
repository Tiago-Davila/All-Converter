import { useEffect, useRef, useState } from 'react'
import type { ConversionResult, Converter, FileEntry } from '../converters/types'
import { getAvailableConverters, getConverterTargets } from '../converters/registry'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { concurrencyForConverter, runWithConcurrency } from '../lib/job-scheduler'
import { createZip } from '../lib/zip'
import { ConversionCard } from './ConversionCard'
import { ProgressBar } from './ProgressBar'

interface BatchItem { state: 'queued' | 'converting' | 'completed' | 'error' | 'cancelled'; percent?: number; error?: string }
interface Choice { converter: Converter; target: string }

/** Cada archivo elige su propio destino (FR-023b): las opciones salen del registry según su tipo detectado. */
function choicesFor(entry: FileEntry): Choice[] {
  return getAvailableConverters(entry.detectedType).flatMap((converter) =>
    getConverterTargets(converter, entry.detectedType).map((target) => ({ converter, target })))
}

const choiceKey = (choice: Choice): string => `${choice.converter.id}::${choice.target}`
const choiceLabel = (choice: Choice, many: boolean): string => (many ? `${choice.target.toUpperCase()} — ${choice.converter.label}` : choice.target.toUpperCase())

function optionsFor(choice: Choice, entry: FileEntry): Record<string, unknown> {
  const options: Record<string, unknown> = { target: choice.target, mime: choice.target === 'jpg' ? 'image/jpeg' : `image/${choice.target}` }
  if (choice.converter.id === 'audio-convert') { options.format = choice.target; options.sourceExtension = entry.detectedType.extension }
  return options
}

export function FileQueue({ entries }: { entries: readonly FileEntry[] }) {
  const ready = entries.filter((entry) => entry.state !== 'rejected')
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [items, setItems] = useState<Record<string, BatchItem>>({})
  const [running, setRunning] = useState(false)
  const [zipUrl, setZipUrl] = useState<string>()
  const abortRef = useRef<AbortController | null>(null)
  const zipUrlRef = useRef<string | undefined>(undefined)

  useEffect(() => () => {
    abortRef.current?.abort()
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current)
  }, [])

  useEffect(() => { zipUrlRef.current = zipUrl }, [zipUrl])

  const chosen = (entry: FileEntry): Choice | undefined => choicesFor(entry).find((choice) => choiceKey(choice) === selection[entry.id])
  const pending = ready.filter((entry) => !chosen(entry))
  const convertible = ready.filter((entry) => chosen(entry))

  const updateItem = (id: string, patch: Partial<BatchItem>) => setItems((current) => ({ ...current, [id]: { ...current[id], ...patch } as BatchItem }))

  const convertAll = async () => {
    if (!convertible.length) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setZipUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return undefined })
    setItems(Object.fromEntries(convertible.map((entry) => [entry.id, { state: 'queued' } satisfies BatchItem])))
    const collected: { result: ConversionResult; relativePath?: string }[] = []

    // Los conversores de lote (p. ej. varias imágenes a un PDF) agrupan los archivos que
    // comparten exactamente el mismo destino; el resto se convierte archivo por archivo.
    const groups = new Map<string, { choice: Choice; entries: FileEntry[] }>()
    const singles: FileEntry[] = []
    for (const entry of convertible) {
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
      if (oversized) { updateItem(oversized.id, { state: 'error', error: fileLimitMessage(oversized.file, choice.converter) }); continue }
      grouped.forEach((entry) => updateItem(entry.id, { state: 'converting', percent: 0 }))
      try {
        const results = await choice.converter.convertMany!(grouped.map((entry) => entry.file), (progress) => grouped.forEach((entry) => updateItem(entry.id, { percent: progress.percent })), optionsFor(choice, grouped[0]), controller.signal)
        results.forEach((result) => collected.push({ result }))
        grouped.forEach((entry) => updateItem(entry.id, { state: 'completed', percent: 100 }))
      } catch (thrown) {
        grouped.forEach((entry) => updateItem(entry.id, { state: thrown instanceof DOMException && thrown.name === 'AbortError' ? 'cancelled' : 'error', error: thrown instanceof Error ? thrown.message : 'Falló la conversión conjunta.' }))
      }
    }

    const concurrency = singles.reduce((lowest, entry) => Math.min(lowest, concurrencyForConverter(chosen(entry)!.converter)), 2)
    await runWithConcurrency(singles.map((entry) => async () => {
      const choice = chosen(entry)!
      if (controller.signal.aborted) { updateItem(entry.id, { state: 'cancelled' }); return }
      if (exceedsFileLimit(entry.file, choice.converter)) { updateItem(entry.id, { state: 'error', error: fileLimitMessage(entry.file, choice.converter) }); return }
      updateItem(entry.id, { state: 'converting', percent: 0 })
      try {
        const results = await choice.converter.convert(entry.file, (progress) => updateItem(entry.id, { percent: progress.percent }), optionsFor(choice, entry), controller.signal)
        results.forEach((result) => collected.push({ result, relativePath: entry.relativePath }))
        updateItem(entry.id, { state: 'completed', percent: 100 })
      } catch (thrown) {
        if (thrown instanceof DOMException && thrown.name === 'AbortError') updateItem(entry.id, { state: 'cancelled' })
        else updateItem(entry.id, { state: 'error', error: thrown instanceof Error ? thrown.message : 'La conversión falló por un error inesperado.' })
      }
    }), singles.length ? concurrency : 2, controller.signal)

    if (collected.length) {
      const buffer = await createZip(collected.map(({ result, relativePath }) => ({ name: result.name, buffer: result.buffer, relativePath })), controller.signal)
      setZipUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/zip' })))
    }
    setRunning(false)
  }

  const tracked = convertible.map((entry) => items[entry.id]).filter((item): item is BatchItem => Boolean(item))
  const globalPercent = tracked.length ? Math.round(tracked.reduce((sum, item) => sum + (item.state === 'completed' ? 100 : item.percent ?? 0), 0) / tracked.length) : undefined
  const limitations = [...new Set(convertible.map((entry) => chosen(entry)?.converter.limitation).filter(Boolean))]

  return <section aria-label="Cola de archivos">
    {ready.length > 0 && <div aria-label="Conversión por lote">
      <ul aria-label="Destinos por archivo">
        {ready.map((entry) => {
          const choices = choicesFor(entry)
          const many = new Set(choices.map((choice) => choice.target)).size !== choices.length
          return <li key={entry.id}>
            <label>{entry.name}
              <select value={selection[entry.id] ?? ''} onChange={(event) => setSelection((current) => ({ ...current, [entry.id]: event.target.value }))} disabled={running}>
                <option value="">Elegí un formato destino</option>
                {choices.map((choice) => <option key={choiceKey(choice)} value={choiceKey(choice)}>{choiceLabel(choice, many)}</option>)}
              </select>
            </label>
            {!chosen(entry) && <span role="note"> — sin formato destino: no se convertirá</span>}
          </li>
        })}
      </ul>
      {pending.length > 0 && <p role="note">{pending.length} archivo(s) sin formato destino elegido: se omitirán al convertir.</p>}
      {limitations.map((limitation) => <p key={limitation} role="note">{limitation}</p>)}
      {!running && <button type="button" onClick={() => { void convertAll() }} disabled={!convertible.length}>Convertir todos</button>}
      {running && <>
        <ProgressBar value={globalPercent} />
        <button type="button" onClick={() => abortRef.current?.abort()}>Cancelar lote</button>
      </>}
      {tracked.length > 0 && <ul aria-label="Progreso del lote">
        {convertible.map((entry) => { const item = items[entry.id]; return item ? <li key={entry.id}>{entry.name}: {item.state}{item.error && <span role="alert"> — {item.error}</span>}</li> : null })}
      </ul>}
      {zipUrl && <a href={zipUrl} download="convertitodo.zip">Descargar ZIP</a>}
    </div>}
    <ul aria-label="Archivos">{entries.map((entry) => <ConversionCard key={entry.id} entry={entry} />)}</ul>
  </section>
}
