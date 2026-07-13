/**
 * UnsupportedTile: tile para archivos de tipo no soportado.
 * Enumera los formatos que sí se aceptan y ofrece acción Quitar.
 * NO es un grupo convertible: sin selector de formato, sin acción de convertir,
 * y no cuenta para el tope de 10 archivos (FR-012, US2).
 */
import React from 'react'

export interface UnsupportedTileProps {
  fileName: string
  /** Lista de formatos que sí acepta la app (extensiones, ej. ["jpg","png","pdf"]). */
  acceptedFormats: readonly string[]
  onRemove: () => void
}

export function UnsupportedTile({
  fileName,
  acceptedFormats,
  onRemove,
}: UnsupportedTileProps): React.ReactElement {
  return (
    <div data-testid="unsupported-tile" role="region" aria-label={`Formato no soportado: ${fileName}`}>
      <p data-testid="unsupported-message">
        <strong>{fileName}</strong> no tiene un formato compatible con esta app.
      </p>
      {acceptedFormats.length > 0 && (
        <p data-testid="accepted-formats">
          Formatos aceptados: {acceptedFormats.join(', ')}
        </p>
      )}
      {/* Sin selector de formato: archivo no convertible (FR-012). */}
      <button type="button" onClick={onRemove} data-testid="btn-remove" aria-label="Quitar archivo no soportado">
        Quitar
      </button>
    </div>
  )
}
