/**
 * Mp3CoverPicker: selector de cover para MP3→MP4.
 * Waveform generado por defecto (DEFAULT_COVER). Opción de reemplazar por imagen
 * y de volver al waveform. "Convertir" NUNCA queda bloqueado (FR-028c, T024, US2).
 */
import React, { useRef } from 'react'

/** Constante que identifica el cover por defecto (waveform generado). */
export const DEFAULT_COVER = 'default-waveform' as const

export type CoverSource =
  | { type: 'default' }
  | { type: 'custom'; file: File; previewUrl: string }

export interface Mp3CoverPickerProps {
  fileName: string
  /** Cover actual; DEFAULT_COVER = waveform automático. */
  cover: CoverSource
  onCoverChange: (cover: CoverSource) => void
}

export function Mp3CoverPicker({
  fileName,
  cover,
  onCoverChange,
}: Mp3CoverPickerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    onCoverChange({ type: 'custom', file, previewUrl })
  }

  function handleResetToDefault() {
    onCoverChange({ type: 'default' })
  }

  const isDefault = cover.type === 'default'

  return (
    <div data-testid="mp3-cover-picker" role="region" aria-label={`Cover para ${fileName}`}>
      <p data-testid="cover-description">
        {isDefault
          ? 'Se usará un waveform generado automáticamente como cover del video.'
          : `Cover personalizado: ${(cover as { type: 'custom'; file: File; previewUrl: string }).file.name}`}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        data-testid="cover-file-input"
        aria-label="Elegir imagen de cover"
        style={{ display: 'none' }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        data-testid="btn-choose-image"
      >
        {isDefault ? 'Elegir imagen' : 'Cambiar imagen'}
      </button>
      {!isDefault && (
        <button
          type="button"
          onClick={handleResetToDefault}
          data-testid="btn-reset-waveform"
        >
          Volver al waveform
        </button>
      )}
      {/* No hay botón de "Convertir" aquí: la conversión NUNCA se bloquea (FR-028c). */}
    </div>
  )
}
