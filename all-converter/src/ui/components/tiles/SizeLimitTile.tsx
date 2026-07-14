/**
 * SizeLimitTile: tile para archivos que exceden el límite del conversor.
 * Muestra el peso real y el máximo; rechaza ANTES de convertir (FR-027, US2).
 */
import React from 'react'

export interface SizeLimitTileProps {
  fileName: string
  /** Tamaño real del archivo en bytes. */
  fileSizeBytes: number
  /** Límite máximo del conversor en MB. */
  maxSizeMB: number
  onRemove: () => void
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export function SizeLimitTile({
  fileName,
  fileSizeBytes,
  maxSizeMB,
  onRemove,
}: SizeLimitTileProps): React.ReactElement {
  return (
    <div data-testid="size-limit-tile" role="region" aria-label={`Archivo muy grande: ${fileName}`}>
      <p data-testid="size-info">
        <strong>{fileName}</strong> pesa{' '}
        <span data-testid="file-size">{formatMB(fileSizeBytes)} MB</span> y el máximo para esta
        conversión es{' '}
        <span data-testid="max-size">{maxSizeMB} MB</span>.
      </p>
      <p data-testid="reject-note">El archivo fue rechazado antes de intentar convertirlo.</p>
      <button type="button" onClick={onRemove} data-testid="btn-remove">
        Quitar
      </button>
    </div>
  )
}
