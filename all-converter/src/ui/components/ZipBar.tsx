/**
 * ZipBar: barra de descarga del ZIP, visible con ≥2 archivos listos (T041, FR-024).
 * Depende de T012 (estados). Equivalente visual obligatorio de 'queue-done-ok'
 * y 'zip' (research §D3).
 */
import React from 'react'

export interface ZipBarProps {
  /** URL del ZIP generado. null = no hay ZIP todavía. */
  zipUrl: string | null
  /** Cantidad de archivos completados. */
  completedCount: number
}

export function ZipBar({ zipUrl, completedCount }: ZipBarProps): React.ReactElement | null {
  // Solo visible con ≥2 archivos listos (FR-024)
  if (completedCount < 2 || !zipUrl) return null

  return (
    <div data-testid="zip-bar" role="region" aria-label="Descarga de todos los archivos">
      <a
        href={zipUrl}
        download="convertitodo.zip"
        data-testid="zip-download-link"
        aria-label={`Descargar ZIP con ${completedCount} archivos convertidos`}
      >
        Descargar ZIP ({completedCount} archivos)
      </a>
    </div>
  )
}
