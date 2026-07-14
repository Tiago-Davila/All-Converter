/**
 * NoAudioTile: tile para videos sin pista de audio.
 * Avisa al usuario y ofrece convertir a otro formato de video como alternativa.
 * Usa FormatSelect para elegir el formato destino (T022, FR-027, US2).
 */
import React from 'react'

export interface NoAudioTileProps {
  fileName: string
  /** Selector de formato de video destino (inyectado desde FormatSelect). */
  formatSelect: React.ReactNode
  onRemove: () => void
}

export function NoAudioTile({
  fileName,
  formatSelect,
  onRemove,
}: NoAudioTileProps): React.ReactElement {
  return (
    <div data-testid="no-audio-tile" role="region" aria-label={`Sin pista de audio: ${fileName}`}>
      <p data-testid="no-audio-message">
        <strong>{fileName}</strong> no tiene pista de audio. No se puede convertir a formato de audio.
      </p>
      <p data-testid="alternative-note">
        Podés convertirlo a otro formato de video:
      </p>
      {formatSelect}
      <button type="button" onClick={onRemove} data-testid="btn-remove">
        Quitar
      </button>
    </div>
  )
}
