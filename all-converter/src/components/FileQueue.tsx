import { useRef, useState } from 'react'
import type { ConversionResult, FileEntry } from '../converters/types'
import { getAvailableConverters, getConverterTargets } from '../converters/registry'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { runWithConcurrency } from '../lib/job-scheduler'
import { createZip } from '../lib/zip'
import { ConversionCard } from './ConversionCard'
import { ProgressBar } from './ProgressBar'

interface BatchItem { state: 'queued' | 'converting' | 'completed' | 'error' | 'cancelled'; percent?: number; error?: string }

export function FileQueue({ entries }: { entries: readonly FileEntry[] }) {
  const ready = entries.filter((entry) => entry.state !== 'rejected')
  const available = ready.length > 1 ? getAvailableConverters(ready[0].detectedType) : []
  const [converterId, setConverterId] = useState<string>()
  const [target, setTarget] = useState<string>()
  const [items, setItems] = useState<Record<string, BatchItem>>({})
  const [running, setRunning] = useState(false)
  const [zipUrl, setZipUrl] = useState<string>()
  const abortRef = useRef<AbortController | null>(null)

  const converter = available.find((candidate) => candidate.id === converterId) ?? available[0]
  const targets = converter ? getConverterTargets(converter, ready[0].detectedType) : []
  const selectedTarget = target && targets.includes(target) ? target : targets[0]

  const updateItem = (id: string, patch: Partial<BatchItem>) => setItems((current) => ({ ...current, [id]: { ...current[id], ...patch } as BatchItem }))

  const convertAll = async () => {
    if (!converter) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setZipUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return undefined })
    setItems(Object.fromEntries(ready.map((entry) => [entry.id, { state: 'queued' } satisfies BatchItem])))
    const options: Record<string, unknown> = selectedTarget ? { target: selectedTarget, mime: selectedTarget === 'jpg' ? 'image/jpeg' : `image/${selectedTarget}` } : {}
    if (converter.id === 'audio-convert') { options.format = selectedTarget; options.sourceExtension = ready[0].detectedType.extension }
    const collected: { result: ConversionResult; relativePath?: string }[] = []
    await runWithConcurrency(ready.map((entry) => async () => {
      if (controller.signal.aborted) { updateItem(entry.id, { state: 'cancelled' }); return }
      if (exceedsFileLimit(entry.file, converter)) { updateItem(entry.id, { state: 'error', error: fileLimitMessage(entry.file, converter) }); return }
      updateItem(entry.id, { state: 'converting', percent: 0 })
      try {
        const results = await converter.convert(entry.file, (progress) => updateItem(entry.id, { percent: progress.percent }), options, controller.signal)
        results.forEach((result) => collected.push({ result, relativePath: entry.relativePath }))
        updateItem(entry.id, { state: 'completed', percent: 100 })
      } catch (thrown) {
        if (thrown instanceof DOMException && thrown.name === 'AbortError') updateItem(entry.id, { state: 'cancelled' })
        else updateItem(entry.id, { state: 'error', error: thrown instanceof Error ? thrown.message : 'La conversión falló por un error inesperado.' })
      }
    }), 2)
    if (collected.length) {
      const buffer = await createZip(collected.map(({ result, relativePath }) => ({ name: result.name, buffer: result.buffer, relativePath })), controller.signal)
      setZipUrl(URL.createObjectURL(new Blob([buffer], { type: 'application/zip' })))
    }
    setRunning(false)
  }

  const tracked = ready.map((entry) => items[entry.id]).filter((item): item is BatchItem => Boolean(item))
  const globalPercent = tracked.length ? Math.round(tracked.reduce((sum, item) => sum + (item.state === 'completed' ? 100 : item.percent ?? 0), 0) / tracked.length) : undefined

  return <section aria-label="Cola de archivos">
    {converter && <div aria-label="Conversión por lote">
      <label>Convertir todos con
        <select value={converter.id} onChange={(event) => { setConverterId(event.target.value); setTarget(undefined) }} disabled={running}>
          {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label>
      {targets.length > 1 && <label>Formato destino
        <select value={selectedTarget} onChange={(event) => setTarget(event.target.value)} disabled={running}>
          {targets.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
        </select>
      </label>}
      {converter.limitation && <p role="note">{converter.limitation}</p>}
      {!running && <button type="button" onClick={() => { void convertAll() }}>Convertir todos</button>}
      {running && <>
        <ProgressBar value={globalPercent} />
        <button type="button" onClick={() => abortRef.current?.abort()}>Cancelar lote</button>
      </>}
      {tracked.length > 0 && <ul aria-label="Progreso del lote">
        {ready.map((entry) => { const item = items[entry.id]; return item ? <li key={entry.id}>{entry.name}: {item.state}{item.error && <span role="alert"> — {item.error}</span>}</li> : null })}
      </ul>}
      {zipUrl && <a href={zipUrl} download="convertitodo.zip">Descargar ZIP</a>}
    </div>}
    <ul aria-label="Archivos">{entries.map((entry) => <ConversionCard key={entry.id} entry={entry} />)}</ul>
  </section>
}
