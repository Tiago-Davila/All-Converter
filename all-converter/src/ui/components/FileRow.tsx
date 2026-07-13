/**
 * FileRow: fila de archivo en la cola con los 5 estados visuales.
 * Cada estado usa color + ícono + texto (FR-015, SC-001).
 * La causa de error se expone al enfocar la fila (FR-043b, T016).
 */
import React from 'react'
import type { FileEntry } from '../../converters/types'
import { toVisualState, STATE_DESCRIPTORS } from './state-map'
import type { RowAction } from './state-map'
import { CANCELLED_ERROR, ENGINE_LOAD_ERROR, makeRowError } from './error-class'
import type { RowError } from './error-class'
import { TOKENS } from '../a11y/tokens'

// ── Íconos inline SVG mínimos ────────────────────────────────────────────────
// Cada ícono tiene una forma geométrica distinta para no-solo-color (SC-001).

function ClockIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function HourglassIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2h8v3L8 8l4 3v3H4v-3l4-3-4-3V2z" />
    </svg>
  )
}

function SpinnerIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" />
    </svg>
  )
}

function CheckIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polyline points="3,8 7,12 13,4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1L1 14h14L8 1z" />
      <rect x="7.25" y="6" width="1.5" height="4" fill="#0b0c11" />
      <rect x="7.25" y="11.5" width="1.5" height="1.5" fill="#0b0c11" />
    </svg>
  )
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface FileRowProps {
  entry: FileEntry
  /** Progreso de conversión 0–100. Solo relevante en estado converting. */
  progress?: number
  /** Si el motor de conversión todavía no terminó de cargar (distingue prep de converting). */
  engineReady?: boolean
  /** Causa de error si el estado es 'error' o 'cancelled'. Viene del conversor o es canónica. */
  errorMessage?: string
  /** Si el archivo ya fue descargado (marca informativa en done). */
  downloaded?: boolean
  onRemove: () => void
  onCancel: () => void
  onDownload: () => void
  onRetry: () => void
  /** Selector de formato destino por fila (T014). Se renderiza cuando está disponible. */
  formatSelect?: React.ReactNode
}

// ── Componente ───────────────────────────────────────────────────────────────

export function FileRow({
  entry,
  progress,
  engineReady = true,
  errorMessage,
  downloaded = false,
  onRemove,
  onCancel,
  onDownload,
  onRetry,
  formatSelect,
}: FileRowProps): React.ReactElement | null {
  const visual = toVisualState(entry.state, engineReady)

  // Las entradas rejected van a un tile de borde, no a esta fila (FR-012).
  if (visual === 'hidden') return null

  const descriptor = STATE_DESCRIPTORS[visual]
  const color = TOKENS[descriptor.colorToken]

  // Resuelve el error efectivo para estado 'error' o 'cancelled'.
  const rowError: RowError | undefined = (() => {
    if (visual !== 'error') return undefined
    if (entry.state === 'cancelled') return CANCELLED_ERROR
    if (errorMessage === ENGINE_LOAD_ERROR.message) return ENGINE_LOAD_ERROR
    if (errorMessage) return makeRowError(errorMessage)
    return { message: 'error desconocido', errorClass: 'transient' }
  })()

  // Acciones efectivas: error transitorio agrega 'retry'.
  const actions: RowAction[] =
    visual === 'error' && rowError?.errorClass === 'transient'
      ? ['remove', 'retry']
      : [...descriptor.actions]

  // Texto de estado para lectores de pantalla.
  const stateLabel =
    visual === 'converting' && progress !== undefined
      ? `Convirtiendo ${Math.round(progress)}%`
      : visual === 'error' && rowError
        ? rowError.message
        : descriptor.label

  // Nombre accesible completo de la fila: nombre de archivo + estado (FR-043b).
  const ariaLabel = `${entry.name}: ${stateLabel}`

  const IconComponent = {
    clock: ClockIcon,
    hourglass: HourglassIcon,
    spinner: SpinnerIcon,
    check: CheckIcon,
    alert: AlertIcon,
  }[descriptor.icon]

  return (
    <div
      role="listitem"
      aria-label={ariaLabel}
      // La causa concreta se expone al enfocar la fila (FR-043b, T016).
      tabIndex={0}
      style={{ color }}
      data-state={visual}
      data-testid="file-row"
    >
      {/* Canal ícono: forma geométrica distinta por estado */}
      <span aria-hidden="true" data-icon={descriptor.icon}>
        <IconComponent />
      </span>

      {/* Canal texto: label distinto por estado */}
      <span data-testid="state-label">
        {visual === 'converting' && progress !== undefined
          ? `Convirtiendo ${Math.round(progress)}%`
          : descriptor.label}
        {visual === 'done' && downloaded && (
          <span aria-label="ya descargado" title="Ya descargado">
            {' ✓'}
          </span>
        )}
      </span>

      <span data-testid="file-name">{entry.name}</span>

      {/* Barra de progreso determinística solo en converting (FR-017) */}
      {visual === 'converting' && (
        <progress
          aria-label={`Progreso: ${Math.round(progress ?? 0)}%`}
          value={progress ?? 0}
          max={100}
          data-testid="progress-bar"
        />
      )}

      {/* Selector de formato destino por fila (T014) */}
      {formatSelect}

      {/* Acciones por estado */}
      <div role="group" aria-label="Acciones">
        {actions.includes('remove') && (
          <button type="button" onClick={onRemove} aria-label="Quitar archivo">
            Quitar
          </button>
        )}
        {actions.includes('cancel') && (
          <button type="button" onClick={onCancel} aria-label="Cancelar conversión">
            Cancelar
          </button>
        )}
        {actions.includes('download') && (
          <button type="button" onClick={onDownload} aria-label="Descargar archivo convertido">
            Descargar
          </button>
        )}
        {actions.includes('retry') && (
          <button type="button" onClick={onRetry} aria-label="Reintentar conversión">
            Reintentar
          </button>
        )}
      </div>
    </div>
  )
}
