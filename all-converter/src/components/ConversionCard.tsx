import { useEffect, useRef, useState } from 'react'
import type { ConversionProgress, FileEntry, QueueState } from '../converters/types'
import { getAvailableConverters } from '../converters/registry'
import { exceedsFileLimit, fileLimitMessage } from '../lib/file-limits'
import { ProgressBar } from './ProgressBar'
import { ResultDownload } from './ResultDownload'

interface Download { url: string; name: string; preview?: 'image' | 'pdf' }

function isMobileDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function ConversionCard({ entry }: { entry: FileEntry }) {
  const available = getAvailableConverters(entry.detectedType)
  const [converterId, setConverterId] = useState(available[0]?.id ?? '')
  const [state, setState] = useState<QueueState>(entry.state)
  const [progress, setProgress] = useState<ConversionProgress>()
  const [error, setError] = useState<string>()
  const [target, setTarget] = useState<string>()
  const [quality, setQuality] = useState(85)
  const [maxWidth, setMaxWidth] = useState<number>()
  const [visual, setVisual] = useState<'waveform' | 'cover'>('waveform')
  const [cover, setCover] = useState<File>()
  const [downloads, setDownloads] = useState<Download[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const converter = available.find((candidate) => candidate.id === converterId)
  const targets = converter ? converter.to.split('|') : []
  const selectedTarget = target && targets.includes(target) ? target : targets[0]
  const mediaBlocked = Boolean(converter?.from.some((source) => source.kind === 'audio' || source.kind === 'video') && isMobileDevice())

  useEffect(() => () => { downloads.forEach((download) => URL.revokeObjectURL(download.url)) }, [downloads])

  const convert = async () => {
    if (!converter || mediaBlocked) return
    if (exceedsFileLimit(entry.file, converter)) { setState('error'); setError(fileLimitMessage(entry.file, converter)); return }
    if (converter.id === 'mp3-to-mp4' && visual === 'cover' && !cover) { setError('Seleccioná una imagen de portada o elegí generar un waveform.'); return }
    const controller = new AbortController()
    abortRef.current = controller
    setState('converting'); setError(undefined); setDownloads([]); setProgress({ stage: 'Iniciando' })
    try {
      const options: Record<string, unknown> = {}
      if (converter.id === 'image-convert') {
        options.mime = selectedTarget === 'jpg' ? 'image/jpeg' : `image/${selectedTarget}`
        options.quality = quality / 100
        if (maxWidth) options.maxWidth = maxWidth
      } else if (converter.id === 'audio-convert') options.format = selectedTarget
      else if (converter.id === 'mp3-to-mp4') {
        options.generateWaveform = visual === 'waveform'
        if (cover) options.cover = await cover.arrayBuffer()
      } else if (selectedTarget) options.target = selectedTarget
      const results = await converter.convert(entry.file, setProgress, options, controller.signal)
      setDownloads(results.map((result) => ({ url: URL.createObjectURL(new Blob([result.buffer], { type: result.mime })), name: result.name, preview: result.previewKind })))
      setState('completed')
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === 'AbortError') { setState('ready'); setProgress(undefined) }
      else { setState('error'); setError(thrown instanceof Error ? thrown.message : 'No se pudo completar la conversión. Probá nuevamente con un archivo más chico o válido.') }
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
        <select value={converterId} onChange={(event) => { setConverterId(event.target.value); setTarget(undefined); setError(undefined) }} disabled={state === 'converting'}>
          {available.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label>
      {targets.length > 1 && <label>Formato destino
        <select value={selectedTarget} onChange={(event) => setTarget(event.target.value)} disabled={state === 'converting'}>
          {targets.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
        </select>
      </label>}
      {converter?.id === 'image-convert' && <fieldset>
        <legend>Opciones de imagen</legend>
        <label>Calidad {quality}%<input aria-label="Calidad" type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>
        <label>Ancho máximo (px)<input aria-label="Ancho máximo" type="number" min="1" value={maxWidth ?? ''} onChange={(event) => setMaxWidth(event.target.value ? Number(event.target.value) : undefined)} /></label>
        {selectedTarget === 'jpg' && <p role="note">La transparencia se aplana sobre fondo blanco al convertir a JPG.</p>}
      </fieldset>}
      {converter?.id === 'mp3-to-mp4' && <fieldset>
        <legend>Contenido visual</legend>
        <label><input type="radio" name={`visual-${entry.id}`} checked={visual === 'waveform'} onChange={() => setVisual('waveform')} />Generar waveform</label>
        <label><input type="radio" name={`visual-${entry.id}`} checked={visual === 'cover'} onChange={() => setVisual('cover')} />Usar portada</label>
        {visual === 'cover' && <label>Imagen de portada<input aria-label="Imagen de portada" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setCover(event.target.files?.[0])} /></label>}
      </fieldset>}
      {converter?.limitation && <p role="note">{converter.limitation}</p>}
      {mediaBlocked && <p role="alert">Las conversiones de audio y video solo están disponibles en computadoras de escritorio.</p>}
      {state !== 'converting' && <button type="button" onClick={() => { void convert() }} disabled={mediaBlocked}>Convertir</button>}
      {state === 'converting' && <><ProgressBar value={progress?.percent} /><span>{progress?.stage}</span><button type="button" onClick={() => abortRef.current?.abort()}>Cancelar</button></>}
      {error && <p role="alert">{error}</p>}
      {state === 'completed' && downloads.map((download) => <ResultDownload key={download.url} href={download.url} name={download.name} preview={download.preview} />)}
    </>}
  </li>
}
