/**
 * FormatSelect: selector de formato destino POR ARCHIVO (001 FR-023b).
 * Poblado desde getAvailableConverters + getConverterTargets del registry de 001.
 * undefined = "sin elegir": la fila no se convierte pero no bloquea al resto (FR-023c).
 *
 * data-model.md §Selector de destino (por archivo).
 */
import React from 'react'
import { play } from 'cuelume'
import type { FileEntry } from '../../converters/types'
import { getAvailableConverters, getConverterTargets } from '../../converters/registry'

export interface FormatSelectProps {
  entry: FileEntry
  /** undefined = sin elegir; la fila no se convierte pero no bloquea al resto. */
  value: string | undefined
  onChange: (choiceKey: string) => void
  disabled?: boolean
}

export function FormatSelect({
  entry,
  value,
  onChange,
  disabled = false,
}: FormatSelectProps): React.ReactElement {
  // Solo destinos válidos para el tipo detectado del archivo (Principio III).
  const converters = getAvailableConverters(entry.detectedType)
  const options: Array<{ key: string; label: string }> = []

  for (const converter of converters) {
    const targets = getConverterTargets(converter, entry.detectedType)
    for (const target of targets) {
      const key = `${converter.id}::${target}`
      if (!options.some((o) => o.key === key)) {
        options.push({ key, label: `${converter.label} → ${target.toUpperCase()}` })
      }
    }
  }

  return (
    <select
      aria-label={`Formato destino para ${entry.name}`}
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value) { play('toggle'); onChange(e.target.value) }
      }}
      disabled={disabled}
      data-testid="format-select"
    >
      <option value="">Sin elegir</option>
      {options.map((opt) => (
        <option key={opt.key} value={opt.key}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
