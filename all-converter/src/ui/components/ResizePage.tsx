/**
 * ResizePage (003): página aparte para cambiar la resolución de una imagen.
 * No pasa por el registry ni por la cola: una imagen por vez, sin conversión de
 * formato obligatoria (FR-001, FR-015).
 *
 * La matemática vive en lib/image-resize.ts y la comparte con el worker, así que
 * el invariante 32 / 1920 / 1080 se define una sola vez.
 *
 * Las dimensiones reales salen del <img> de la vista previa (naturalWidth/Height):
 * evita decodificar dos veces y su onError es, gratis, la detección de "este
 * formato tu navegador no lo abre" (FR-002).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { imageResizeConverter } from '../../converters/image-resize'
import { exceedsFileLimit, fileLimitMessage } from '../../lib/file-limits'
import { detectFileType } from '../../lib/file-type'
import { isAnimatedRaster } from '../../lib/image-format'
import {
  RESIZE_LONG,
  RESIZE_MIN,
  RESIZE_SHORT,
  clampAxis,
  initialPair,
  linkedPair,
  maxForAxis,
  type Dimensions,
  type ResizeAxis,
} from '../../lib/image-resize'
import { Header } from './Header'
import { Icon } from './icons'

/** Lo único que el canvas sabe codificar (FR-009). */
const ENCODABLE = ['image/png', 'image/jpeg', 'image/webp'] as const
type Encodable = (typeof ENCODABLE)[number]
type OutputChoice = 'original' | Encodable

const OUTPUT_LABEL: Record<Encodable, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WebP',
}

const isEncodable = (mime: string): mime is Encodable => (ENCODABLE as readonly string[]).includes(mime)

interface Loaded {
  file: File
  previewUrl: string
  /** Mime real por magic bytes (Regla 7), con el del navegador como respaldo. */
  mime: string
  /** Puede tener más de un fotograma: se usará el primero (FR-012). */
  maybeAnimated: boolean
}

interface Output {
  url: string
  name: string
  sizeBytes: number
  width: number
  height: number
}

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function ResizePage(): React.ReactElement {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [natural, setNatural] = useState<Dimensions | null>(null)
  const [size, setSize] = useState<Dimensions>({ width: RESIZE_MIN, height: RESIZE_MIN })
  const [draft, setDraft] = useState({ width: '', height: '' })
  const [linked, setLinked] = useState(true)
  const [output, setOutput] = useState<OutputChoice>('original')
  const [quality, setQuality] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Output | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Los object URL se revocan al reemplazarlos y al desmontar (patrón de FileQueue).
  const loadedRef = useRef<Loaded | null>(null)
  const resultRef = useRef<Output | null>(null)
  loadedRef.current = loaded
  resultRef.current = result
  useEffect(() => () => {
    if (loadedRef.current) URL.revokeObjectURL(loadedRef.current.previewUrl)
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url)
  }, [])

  /** Cualquier cambio de parámetros invalida el resultado ya generado. */
  const dropResult = useCallback(() => {
    setResult((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }, [])

  const accept = useCallback(async (file: File | undefined) => {
    if (!file) return
    setError(null)
    dropResult()
    if (exceedsFileLimit(file, imageResizeConverter)) {
      setError(fileLimitMessage(file, imageResizeConverter))
      return
    }
    const detected = await detectFileType(file)
    // Solo la cabecera: alcanza para los marcadores de animación y no lee 50 MB.
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
    setLoaded((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl)
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        mime: detected.mime || file.type,
        maybeAnimated: detected.mime === 'image/gif' || isAnimatedRaster(head),
      }
    })
    setNatural(null)
  }, [dropResult])

  const onPreviewLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    const nat = { width: naturalWidth, height: naturalHeight }
    const start = initialPair(nat)
    setNatural(nat)
    setSize(start)
    setDraft({ width: String(start.width), height: String(start.height) })
  }

  const onPreviewError = () => {
    setNatural(null)
    setError('Tu navegador no puede abrir este formato de imagen. Probá con otro archivo.')
  }

  /** Mientras se escribe, el otro eje sigue la proporción sin clamear (eso pasa al salir del campo). */
  const onAxisChange = (axis: ResizeAxis, text: string) => {
    dropResult()
    const value = Number(text)
    if (!linked || !natural || !Number.isFinite(value) || value <= 0) {
      setDraft((current) => ({ ...current, [axis]: text }))
      return
    }
    const partner = axis === 'width'
      ? Math.max(1, Math.round((value * natural.height) / natural.width))
      : Math.max(1, Math.round((value * natural.width) / natural.height))
    setDraft(axis === 'width' ? { width: text, height: String(partner) } : { width: String(partner), height: text })
  }

  /** Al salir del campo se fija el par canónico, ya dentro del invariante. */
  const commit = (axis: ResizeAxis) => {
    if (!natural) return
    const typed = Number(draft[axis])
    let next: Dimensions
    if (linked) {
      next = linkedPair(axis, typed, natural)
    } else {
      const other = axis === 'width' ? size.height : size.width
      const value = clampAxis(typed, other)
      next = axis === 'width' ? { width: value, height: other } : { width: other, height: value }
    }
    setSize(next)
    setDraft({ width: String(next.width), height: String(next.height) })
  }

  const toggleLinked = (next: boolean) => {
    setLinked(next)
    dropResult()
    if (next && natural) {
      const pair = linkedPair('width', size.width, natural)
      setSize(pair)
      setDraft({ width: String(pair.width), height: String(pair.height) })
    }
  }

  const sourceMime = loaded?.mime ?? ''
  const originalEncodable = isEncodable(sourceMime)
  const targetMime: Encodable = output === 'original' ? (originalEncodable ? sourceMime : 'image/png') : output
  const fallbackToPng = output === 'original' && !originalEncodable && loaded !== null
  const upscaling = natural !== null && (size.width > natural.width || size.height > natural.height)

  const download = async () => {
    if (!loaded || !natural || busy) return
    setBusy(true)
    setError(null)
    try {
      const [converted] = await imageResizeConverter.convert(
        loaded.file,
        () => {},
        { mime: targetMime, quality: quality / 100, width: size.width, height: size.height },
        new AbortController().signal
      )
      if (!converted) throw new Error('No se generó ninguna imagen.')
      const url = URL.createObjectURL(new Blob([converted.buffer], { type: converted.mime }))
      const next: Output = { url, name: converted.name, sizeBytes: converted.sizeBytes, ...size }
      setResult((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return next
      })
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = converted.name
      anchor.click()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo redimensionar la imagen.')
    } finally {
      setBusy(false)
    }
  }

  const ready = loaded !== null && natural !== null

  return (
    <div className="ct-page">
      <div className="ct-shell">
        <Header />
        <a className="ct-resize-back" href="#/">
          <Icon name="chev" size={14} className="ct-icn-back" />
          Volver al convertidor
        </a>

        <section className="ct-resize" aria-label="Redimensionar imagen">
          <header className="ct-resize-head">
            <h1 className="ct-resize-title">Redimensionar imagen</h1>
            <p className="ct-resize-lead">
              Cambiá la resolución de cualquier imagen sin que salga de tu dispositivo.
              Hasta {RESIZE_LONG} × {RESIZE_SHORT} px, desde {RESIZE_MIN} × {RESIZE_MIN}.
            </p>
          </header>

          <div
            className="ct-resize-drop"
            data-drag-over={dragOver ? 'true' : 'false'}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragOver(false)
              void accept(event.dataTransfer.files[0])
            }}
          >
            {loaded ? (
              <img
                className="ct-resize-preview"
                src={loaded.previewUrl}
                alt={`Vista previa de ${loaded.file.name}`}
                onLoad={onPreviewLoad}
                onError={onPreviewError}
                data-testid="resize-preview"
              />
            ) : (
              <div className="ct-resize-empty">
                <span className="ct-resize-glyph" aria-hidden="true"><Icon name="img" size={26} /></span>
                <p className="ct-resize-empty-text">Arrastrá una imagen o elegila desde tu dispositivo</p>
                <button
                  type="button"
                  className="ct-btn ct-btn-dark"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="resize-choose"
                >
                  <Icon name="folder" size={16} />
                  Elegir imagen
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => { void accept(event.target.files?.[0]) }}
              data-testid="resize-input"
            />
          </div>

          {loaded && (
            <p className="ct-resize-source" data-testid="resize-source">
              <strong>{loaded.file.name}</strong>
              {natural
                ? ` · original ${natural.width} × ${natural.height} px · ${formatBytes(loaded.file.size)}`
                : ' · leyendo dimensiones…'}
              <button type="button" className="ct-btn ct-btn-outline ct-btn-sm" onClick={() => fileInputRef.current?.click()}>
                Cambiar imagen
              </button>
            </p>
          )}

          {ready && (
            <div className="ct-resize-controls">
              <div className="ct-resize-axes">
                <label className="ct-resize-field">
                  <span>Ancho (px)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Ancho en píxeles"
                    min={RESIZE_MIN}
                    max={maxForAxis(size.height)}
                    value={draft.width}
                    onChange={(event) => onAxisChange('width', event.target.value)}
                    onBlur={() => commit('width')}
                    data-testid="resize-width"
                  />
                </label>
                <span className="ct-resize-times" aria-hidden="true">×</span>
                <label className="ct-resize-field">
                  <span>Alto (px)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    aria-label="Alto en píxeles"
                    min={RESIZE_MIN}
                    max={maxForAxis(size.width)}
                    value={draft.height}
                    onChange={(event) => onAxisChange('height', event.target.value)}
                    onBlur={() => commit('height')}
                    data-testid="resize-height"
                  />
                </label>
              </div>

              <label className="ct-resize-check">
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={(event) => toggleLinked(event.target.checked)}
                  data-testid="resize-linked"
                />
                Mantener proporción
              </label>

              <p className="ct-note">
                Entre {RESIZE_MIN} y {maxForAxis(Math.min(size.width, size.height))} px por lado.
                El lado largo nunca pasa de {RESIZE_LONG} y el corto de {RESIZE_SHORT}.
              </p>

              <div className="ct-resize-row">
                <label className="ct-resize-field">
                  <span>Formato de salida</span>
                  <span className="ct-select-wrap">
                    <select
                      className="ct-select"
                      value={output}
                      onChange={(event) => { setOutput(event.target.value as OutputChoice); dropResult() }}
                      data-testid="resize-format"
                    >
                      <option value="original">
                        Original{originalEncodable ? ` (${OUTPUT_LABEL[sourceMime]})` : ''}
                      </option>
                      <option value="image/webp">WebP</option>
                      <option value="image/jpeg">JPG</option>
                      <option value="image/png">PNG</option>
                    </select>
                    <Icon name="chev" size={13} className="ct-select-chev" />
                  </span>
                </label>

                {targetMime !== 'image/png' && (
                  <label className="ct-resize-field ct-resize-quality">
                    <span>Calidad {quality}%</span>
                    <input
                      type="range"
                      aria-label="Calidad"
                      min={1}
                      max={100}
                      value={quality}
                      onChange={(event) => { setQuality(Number(event.target.value)); dropResult() }}
                    />
                  </label>
                )}
              </div>

              {fallbackToPng && (
                <p className="ct-note ct-note-warn" data-testid="resize-fallback">
                  <Icon name="alert" size={14} />
                  El navegador no puede guardar {sourceMime.replace('image/', '').toUpperCase()}. Se descargará como PNG.
                </p>
              )}
              {loaded.maybeAnimated && (
                <p className="ct-note ct-note-warn">
                  <Icon name="info" size={14} />
                  Si la imagen está animada, se usará el primer fotograma.
                </p>
              )}
              {targetMime === 'image/jpeg' && (
                <p className="ct-note">La transparencia se aplana sobre fondo blanco al convertir a JPG.</p>
              )}
              {upscaling && (
                <p className="ct-note ct-note-warn">
                  <Icon name="info" size={14} />
                  Estás agrandando la imagen; puede verse borrosa.
                </p>
              )}

              <button
                type="button"
                className="ct-btn ct-btn-hero-primary ct-resize-go"
                onClick={() => { void download() }}
                disabled={busy}
                data-testid="resize-go"
              >
                <Icon name={busy ? 'spin' : 'download'} size={16} />
                {busy ? 'Redimensionando…' : `Descargar ${size.width} × ${size.height}`}
              </button>
            </div>
          )}

          {error && <p role="alert" className="ct-resize-error">{error}</p>}

          <div role="status" aria-live="polite" className="ct-visually-hidden">
            {result ? `Imagen lista, ${result.width} por ${result.height} píxeles.` : ''}
          </div>

          {result && (
            <p className="ct-resize-result">
              <Icon name="check" size={15} className="ct-icn-ok" />
              <a className="ct-btn ct-btn-dark ct-btn-sm" href={result.url} download={result.name} data-testid="resize-download">
                Descargar {result.name}
              </a>
              <span className="ct-resize-result-meta">
                {result.width} × {result.height} px · {formatBytes(result.sizeBytes)}
              </span>
            </p>
          )}
        </section>

        <p className="ct-footnote">
          Todo ocurre en tu dispositivo: la imagen nunca se sube a ningún servidor.
        </p>
      </div>
    </div>
  )
}
