/**
 * PartialFidelityNote: aviso previo de fidelidad parcial para conversiones DOCX↔PDF.
 * Se muestra ANTES de convertir (FR-027, US2).
 */
import React from 'react'

export interface PartialFidelityNoteProps {
  fileName: string
  /** Conversión que se va a realizar, ej. "DOCX → PDF" o "PDF → DOCX". */
  conversionLabel: string
}

export function PartialFidelityNote({
  fileName,
  conversionLabel,
}: PartialFidelityNoteProps): React.ReactElement {
  return (
    <div
      data-testid="partial-fidelity-note"
      role="note"
      aria-label={`Aviso de fidelidad parcial para ${fileName}`}
    >
      <p data-testid="fidelity-message">
        La conversión <strong>{conversionLabel}</strong> puede causar leves diferencias de formato
        en <strong>{fileName}</strong>. El resultado puede variar levemente respecto al original.
      </p>
    </div>
  )
}
