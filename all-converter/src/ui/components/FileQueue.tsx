/**
 * FileQueue (capa UI 002): cola de archivos con integración de tiles de borde.
 * Los avisos de borde aparecen ANTES de que la conversión pueda iniciarse (FR-027, T025).
 * La lógica de conversión vive en src/components/FileQueue.tsx (001); este componente
 * es la vista de la capa de experiencia que agrega los tiles de US2.
 */
import React from 'react'
import type { FileEntry } from '../../converters/types'
import { PasswordPrompt } from './tiles/PasswordPrompt'
import { SizeLimitTile } from './tiles/SizeLimitTile'
import { UnsupportedTile } from './tiles/UnsupportedTile'
import { ScannedPdfTile } from './tiles/ScannedPdfTile'
import { NoAudioTile } from './tiles/NoAudioTile'
import { PartialFidelityNote } from './tiles/PartialFidelityNote'
import { Mp3CoverPicker } from './tiles/Mp3CoverPicker'
import type { CoverSource } from './tiles/Mp3CoverPicker'
import { getAvailableConverters } from '../../converters/registry'

// ── Tipos de aviso de borde ──────────────────────────────────────────────────

export type EdgeKind =
  | 'password'
  | 'size-limit'
  | 'unsupported'
  | 'scanned-pdf'
  | 'no-audio'
  | 'partial-fidelity'
  | 'mp3-cover'

export interface EdgeState {
  kind: EdgeKind
  /** Solo para size-limit: MB máximo del conversor elegido. */
  maxSizeMB?: number
  /** Solo para partial-fidelity: etiqueta de la conversión, ej. "DOCX → PDF". */
  conversionLabel?: string
  /** Solo para password: si la última contraseña fue incorrecta. */
  wrongPassword?: boolean
  /** Solo para mp3-cover: estado del cover actual. */
  cover?: CoverSource
}

export interface FileQueueEntryState {
  entry: FileEntry
  edge?: EdgeState
  /** true = el aviso de borde fue reconocido y el archivo puede proceder (FR-027). */
  edgeAcknowledged?: boolean
}

export interface FileQueueProps {
  entries: readonly FileQueueEntryState[]
  /** Controlado: si hay avisos de borde pendientes, la conversión no puede iniciarse. */
  canConvert: boolean
  onUnlock: (entryId: string, password: string) => void
  onRemove: (entryId: string) => void
  onCoverChange: (entryId: string, cover: CoverSource) => void
  /** Slot para renderizar el contenido de conversión normal (001 FileQueue). */
  children?: React.ReactNode
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function acceptedFormatsFor(entry: FileEntry): string[] {
  const converters = getAvailableConverters(entry.detectedType)
  const exts = new Set<string>()
  for (const c of converters) {
    exts.add(c.to)
  }
  return Array.from(exts)
}

// ── Componente ───────────────────────────────────────────────────────────────

export function FileQueue({
  entries,
  canConvert,
  onUnlock,
  onRemove,
  onCoverChange,
  children,
}: FileQueueProps): React.ReactElement {
  const edgePending = entries.some((s) => s.edge && !s.edgeAcknowledged)

  return (
    <section aria-label="Cola de archivos" data-testid="file-queue">
      {/* Tiles de borde: se muestran ANTES de que la conversión pueda iniciarse (FR-027). */}
      {entries.map(({ entry, edge, edgeAcknowledged }) => {
        if (!edge || edgeAcknowledged) return null
        const key = entry.id

        switch (edge.kind) {
          case 'password':
            return (
              <PasswordPrompt
                key={key}
                fileName={entry.name}
                wrongPassword={edge.wrongPassword}
                onUnlock={(pwd) => onUnlock(entry.id, pwd)}
                onRemove={() => onRemove(entry.id)}
              />
            )
          case 'size-limit':
            return (
              <SizeLimitTile
                key={key}
                fileName={entry.name}
                fileSizeBytes={entry.sizeBytes}
                maxSizeMB={edge.maxSizeMB ?? 0}
                onRemove={() => onRemove(entry.id)}
              />
            )
          case 'unsupported':
            return (
              <UnsupportedTile
                key={key}
                fileName={entry.name}
                acceptedFormats={acceptedFormatsFor(entry)}
                onRemove={() => onRemove(entry.id)}
              />
            )
          case 'scanned-pdf':
            return (
              <ScannedPdfTile
                key={key}
                fileName={entry.name}
                onRemove={() => onRemove(entry.id)}
              />
            )
          case 'no-audio':
            return (
              <NoAudioTile
                key={key}
                fileName={entry.name}
                formatSelect={<select aria-label="Formato de video" />}
                onRemove={() => onRemove(entry.id)}
              />
            )
          case 'partial-fidelity':
            return (
              <PartialFidelityNote
                key={key}
                fileName={entry.name}
                conversionLabel={edge.conversionLabel ?? ''}
              />
            )
          case 'mp3-cover':
            return (
              <Mp3CoverPicker
                key={key}
                fileName={entry.name}
                cover={edge.cover ?? { type: 'default' }}
                onCoverChange={(cover) => onCoverChange(entry.id, cover)}
              />
            )
          default:
            return null
        }
      })}

      {/* El slot de conversión solo se renderiza si no hay avisos de borde pendientes (FR-027). */}
      {!edgePending && canConvert && children}
    </section>
  )
}
