/**
 * QueueRow: una fila de la cola, memoizada.
 *
 * Está separada de FileQueue por rendimiento (006 FR-022): con 200 archivos, cada evento de
 * progreso re-renderizaba las 200 filas. Con `React.memo` sólo se vuelve a dibujar la fila
 * cuyos datos cambiaron, y por eso todas las props tienen que ser estables: los callbacks
 * llegan en un único objeto `actions` que FileQueue mantiene idéntico entre renders.
 */
import React from 'react'
import type { Converter, FileEntry } from '../converters/types'
import { Icon, type IconName } from '../ui/components/icons'
import type { ErrorClass } from '../lib/error-class'

export interface BatchItem {
  state: 'queued' | 'paused' | 'converting' | 'completed' | 'error' | 'cancelled'
  percent?: number
  error?: string
  errorClass?: ErrorClass
}

export interface Choice { converter: Converter; target: string }
export interface RowDownload { url: string; name: string }
/** Opciones extra por fila según el conversor elegido (calidad, portada…). */
export interface RowOptions { quality: number; maxWidth?: number; visual: 'waveform' | 'cover'; cover?: File; optionsOpen: boolean }

export const DEFAULT_ROW_OPTIONS: RowOptions = { quality: 85, visual: 'waveform', optionsOpen: false }

export const choiceKey = (choice: Choice): string => `${choice.converter.id}::${choice.target}`
export const choiceLabel = (choice: Choice, many: boolean): string =>
  (many ? `${choice.target.toUpperCase()} — ${choice.converter.label}` : choice.target.toUpperCase())

export function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`
}

/** Callbacks de la fila. El objeto es estable: si cambiara, la memoización no serviría. */
export interface QueueRowActions {
  select(entryId: string, value: string): void
  patchOptions(entryId: string, patch: Partial<RowOptions>): void
  markDownloaded(entryId: string): void
  retry(entry: FileEntry): void
  remove(entryId: string): void
}

export interface QueueRowProps {
  entry: FileEntry
  icon: IconName
  item?: BatchItem
  choices: readonly Choice[]
  selectedKey: string
  options: RowOptions
  downloads: readonly RowDownload[]
  downloaded: boolean
  running: boolean
  retrying: boolean
  canRemove: boolean
  actions: QueueRowActions
}

function QueueRowImpl({ entry, icon, item, choices, selectedKey, options, downloads, downloaded, running, retrying, canRemove, actions }: QueueRowProps): React.ReactElement {
  const choice = choices.find((candidate) => choiceKey(candidate) === selectedKey)
  const many = new Set(choices.map((candidate) => candidate.target)).size !== choices.length
  const state = item?.state
  const showImageOptions = choice?.converter.id === 'image-convert'
  const showMp4Options = choice?.converter.id === 'mp3-to-mp4'

  return (
    <div className="ct-row" data-state={state ?? 'pending'}>
      {state === 'completed' && <span className="ct-row-sweep" aria-hidden="true" />}
      <span className="ct-row-glyph" aria-hidden="true">
        <Icon name={icon} size={17} />
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
            value={selectedKey}
            onChange={(event) => actions.select(entry.id, event.target.value)}
            disabled={running}
          >
            <option value="">Elegí un formato destino</option>
            {choices.map((candidate) => <option key={choiceKey(candidate)} value={choiceKey(candidate)}>{choiceLabel(candidate, many)}</option>)}
          </select>
          <Icon name="chev" size={14} className="ct-select-chev" />
        </span>

        {!choice && !state && <span role="note" className="ct-note">sin formato destino: no se convertirá</span>}

        {(state === undefined || state === 'queued') && choice && (
          <span className="ct-pill ct-pill-pending"><span className="ct-pill-dot" aria-hidden="true" />Pendiente</span>
        )}

        {/* Pausado: ícono propio + texto, para distinguirlo sin depender del color (FR-021) */}
        {state === 'paused' && (
          <span className="ct-pill ct-pill-paused"><Icon name="pause" size={12} className="ct-icn" />Pausado</span>
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
              {downloaded ? 'Descargado' : 'Listo'}
            </span>
            {downloads.map((download) => (
              <a
                key={download.url}
                className="ct-btn ct-btn-dark ct-btn-sm"
                href={download.url}
                download={download.name}
                aria-label={`Descargar ${download.name}`}
                onClick={() => actions.markDownloaded(entry.id)}
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
            disabled={retrying}
            onClick={() => actions.retry(entry)}
          >
            <Icon name="refresh" size={14} />
            {retrying ? 'Reintentando…' : 'Reintentar'}
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
            onClick={() => actions.patchOptions(entry.id, { optionsOpen: !options.optionsOpen })}
          >
            Opciones de imagen
            <Icon name="chev" size={12} />
          </button>
        )}

        {canRemove && !running && state !== 'converting' && (
          <button type="button" className="ct-btn-icon" title="Quitar" aria-label={`Quitar ${entry.name}`} onClick={() => actions.remove(entry.id)}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {/* Causa concreta del error, visible y accesible (FR-019, FR-043b) */}
      {state === 'error' && item?.error && <p role="alert" className="ct-row-error-cause">{item.error}</p>}

      {showImageOptions && options.optionsOpen && (
        <div className="ct-row-options">
          <label>Calidad {options.quality}%
            <input aria-label="Calidad" type="range" min="1" max="100" value={options.quality} onChange={(event) => actions.patchOptions(entry.id, { quality: Number(event.target.value) })} />
          </label>
          <label>Ancho máximo (px)
            <input aria-label="Ancho máximo" type="number" min="1" value={options.maxWidth ?? ''} onChange={(event) => actions.patchOptions(entry.id, { maxWidth: event.target.value ? Number(event.target.value) : undefined })} />
          </label>
          {choice?.target === 'jpg' && <span className="ct-note">La transparencia se aplana sobre fondo blanco al convertir a JPG.</span>}
        </div>
      )}

      {/* MP3→MP4: waveform automático por defecto, portada opcional (FR-028/FR-028b) */}
      {showMp4Options && (
        <div className="ct-row-options">
          <label><input type="radio" name={`visual-${entry.id}`} checked={options.visual === 'waveform'} onChange={() => actions.patchOptions(entry.id, { visual: 'waveform' })} />Generar waveform</label>
          <label><input type="radio" name={`visual-${entry.id}`} checked={options.visual === 'cover'} onChange={() => actions.patchOptions(entry.id, { visual: 'cover' })} />Usar portada</label>
          {options.visual === 'cover' && (
            <label>Imagen de portada
              <input aria-label="Imagen de portada" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => actions.patchOptions(entry.id, { cover: event.target.files?.[0] })} />
            </label>
          )}
          <span className="ct-note">{options.visual === 'waveform' ? 'Se usará un waveform generado automáticamente.' : 'Se usará tu imagen como fondo del video.'}</span>
        </div>
      )}
    </div>
  )
}

export const QueueRow = React.memo(QueueRowImpl)
