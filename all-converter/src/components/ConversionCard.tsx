import { useEffect, useRef, useState } from 'react'
import type { ConversionProgress, FileEntry, QueueState } from '../converters/types'
import { getAvailableConverters } from '../converters/registry'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { ProgressBar } from './ProgressBar'
import { ResultDownload } from './ResultDownload'

interface Download { url: string; name: string }

export function ConversionCard({ entry }: { entry: FileEntry }) {
  const available = getAvailableConverters(entry.detectedType)
  const [converterId, setConverterId] = useState(available[0]?.id ?? '')
  const [state, setState] = useState<QueueState>(entry.state)
  const [progress, setProgress] = useState<ConversionProgress>()
  const [error, setError] = useState<string>()
  const [target, setTarget] = useState<string>()
  const [downloads, setDownloads] = useState<Download[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const converter = available.find((candidate) => candidate.id === converterId)
  const targets = converter ? converter.to.split('|') : []
  const selectedTarget = target && targets.includes(target) ? target : targets[0]

  useEffect(() => () => { downloads.forEach((download) => URL.revokeObjectURL(download.url)) }, [downloads])

  const convert = async () => {
    if (!converter) return
    if (exceedsFileLimit(entry.file, converter)) { setState('error'); setError(fileLimitMessage(entry.file, converter)); return }
    const controller = new AbortController()
    abortRef.current = controller
    setState('converting'); setError(undefined); setDownloads([]); setProgress({ stage: 'Iniciando' })
    try {
      const options = selectedTarget ? { target: selectedTarget, mime: selectedTarget === 'jpg' ? 'image/jpeg' : `image/${selectedTarget}` } : {}
      const results = await converter.convert(entry.file, setProgress, options, controller.signal)
      setDownloads(results.map((result) => ({ url: URL.createObjectURL(new Blob([result.buffer], { type: result.mime })), name: result.name })))
      setState('completed')
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === 'AbortError') { setState('ready'); setProgress(undefined) }
      else { setState('error'); setError(thrown instanceof Error ? thrown.message : 'La conversión falló por un error inesperado.') }
    }
  }

  return <li>
    <strong>{entry.name}</strong>
    <span>{entry.detectedType.mime || 'Tipo desconocido'}</span>
    <span>{state}</span>
    {entry.rejectionReason && <p role="alert">{entry.rejectionReason}</p>}
    {entry.state !== 'rejected' && !available.length && <p role="alert">Tipo no soportado: no hay conversiones disponibles para este archivo.</p>}
    {entry.state !== 'rejected' && available.length > 0 && <>
      <label>Conversión
        <select value={converterId} onChange={(event) => { setConverterId(event.target.value); setTarget(undefined) }} disabled={state === 'converting'}>
          {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label>
      {targets.length > 1 && <label>Formato destino
        <select value={selectedTarget} onChange={(event) => setTarget(event.target.value)} disabled={state === 'converting'}>
          {targets.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
        </select>
      </label>}
      {converter?.limitation && <p role="note">{converter.limitation}</p>}
      {state !== 'converting' && <button type="button" onClick={() => { void convert() }}>Convertir</button>}
      {state === 'converting' && <>
        <ProgressBar value={progress?.percent} />
        <span>{progress?.stage}</span>
        <button type="button" onClick={() => abortRef.current?.abort()}>Cancelar</button>
      </>}
      {error && <p role="alert">{error}</p>}
      {state === 'completed' && downloads.map((download) => <ResultDownload key={download.url} href={download.url} name={download.name} />)}
    </>}
  </li>
}
