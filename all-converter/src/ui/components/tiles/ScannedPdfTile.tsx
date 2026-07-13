/**
 * ScannedPdfTile: tile para PDFs escaneados (solo imagen, sin texto extraíble).
 * Muestra aviso y control "OCR (próximamente)" visible pero inerte:
 * aria-disabled, sin handler. No se implementa OCR (T021, FR-027, US2).
 */
import React from 'react'

export interface ScannedPdfTileProps {
  fileName: string
  onRemove: () => void
}

export function ScannedPdfTile({
  fileName,
  onRemove,
}: ScannedPdfTileProps): React.ReactElement {
  return (
    <div data-testid="scanned-pdf-tile" role="region" aria-label={`PDF escaneado: ${fileName}`}>
      <p data-testid="scanned-message">
        <strong>{fileName}</strong> es un PDF escaneado. No hay texto que extraer.
      </p>
      {/* OCR visible pero inerte. Sin handler. Sin implementación (fuera de alcance). */}
      <button
        type="button"
        aria-disabled="true"
        data-testid="btn-ocr"
        tabIndex={0}
        onClick={undefined}
      >
        OCR (próximamente)
      </button>
      <button type="button" onClick={onRemove} data-testid="btn-remove">
        Quitar
      </button>
    </div>
  )
}
