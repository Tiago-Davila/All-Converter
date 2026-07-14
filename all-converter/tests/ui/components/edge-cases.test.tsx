// @vitest-environment jsdom
/**
 * Prueba de integración T025: verifica que cada aviso de borde aparece
 * ANTES de que la conversión pueda iniciarse (FR-027).
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { FileQueue } from '../../../src/ui/components/FileQueue'
import type { FileQueueEntryState } from '../../../src/ui/components/FileQueue'
import type { FileEntry } from '../../../src/converters/types'

function makeEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'e1',
    file: new File(['data'], 'test.pdf', { type: 'application/pdf' }),
    name: 'test.pdf',
    sizeBytes: 1024,
    detectedType: { kind: 'pdf', mime: 'application/pdf', extension: 'pdf', detection: 'magic-bytes' },
    state: 'ready',
    ...overrides,
  }
}

const noop = vi.fn()
const defaultProps = { canConvert: true, onUnlock: noop, onRemove: noop, onCoverChange: noop }

describe('FileQueue — integración de tiles de borde (T025)', () => {
  it('muestra PasswordPrompt cuando kind=password', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry(), edge: { kind: 'password' } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('password-prompt')).toBeTruthy()
  })

  it('muestra SizeLimitTile cuando kind=size-limit', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry({ sizeBytes: 50_000_000 }), edge: { kind: 'size-limit', maxSizeMB: 25 } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('size-limit-tile')).toBeTruthy()
  })

  it('muestra UnsupportedTile cuando kind=unsupported', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry({ state: 'rejected' }), edge: { kind: 'unsupported' } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('unsupported-tile')).toBeTruthy()
  })

  it('muestra ScannedPdfTile cuando kind=scanned-pdf', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry(), edge: { kind: 'scanned-pdf' } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('scanned-pdf-tile')).toBeTruthy()
  })

  it('muestra NoAudioTile cuando kind=no-audio', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry({ detectedType: { kind: 'video', mime: 'video/mp4', extension: 'mp4', detection: 'magic-bytes' } }), edge: { kind: 'no-audio' } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('no-audio-tile')).toBeTruthy()
  })

  it('muestra PartialFidelityNote cuando kind=partial-fidelity', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry(), edge: { kind: 'partial-fidelity', conversionLabel: 'PDF → DOCX' } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('partial-fidelity-note')).toBeTruthy()
  })

  it('muestra Mp3CoverPicker cuando kind=mp3-cover', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry({ name: 'song.mp3', detectedType: { kind: 'audio', mime: 'audio/mpeg', extension: 'mp3', detection: 'magic-bytes' } }), edge: { kind: 'mp3-cover', cover: { type: 'default' } } },
    ]
    render(<FileQueue {...defaultProps} entries={entries} />)
    expect(screen.getByTestId('mp3-cover-picker')).toBeTruthy()
  })

  it('NO renderiza el slot de conversión mientras hay avisos de borde pendientes', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry(), edge: { kind: 'password' } },
    ]
    render(
      <FileQueue {...defaultProps} entries={entries}>
        <div data-testid="conversion-slot">Convertir</div>
      </FileQueue>
    )
    expect(screen.queryByTestId('conversion-slot')).toBeNull()
  })

  it('renderiza el slot de conversión cuando todos los avisos están reconocidos', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry(), edge: { kind: 'password' }, edgeAcknowledged: true },
    ]
    render(
      <FileQueue {...defaultProps} entries={entries}>
        <div data-testid="conversion-slot">Convertir</div>
      </FileQueue>
    )
    expect(screen.getByTestId('conversion-slot')).toBeTruthy()
  })

  it('renderiza el slot de conversión cuando no hay avisos', () => {
    const entries: FileQueueEntryState[] = [
      { entry: makeEntry() },
    ]
    render(
      <FileQueue {...defaultProps} entries={entries}>
        <div data-testid="conversion-slot">Convertir</div>
      </FileQueue>
    )
    expect(screen.getByTestId('conversion-slot')).toBeTruthy()
  })
})
