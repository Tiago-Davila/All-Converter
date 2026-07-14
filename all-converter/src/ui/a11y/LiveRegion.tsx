/**
 * LiveRegion: región aria-live="polite" para anuncios consolidados por lote.
 * NUNCA anuncia por archivo individual: una cola de 10 produce 1 anuncio (FR-043).
 *
 * data-model.md §Anuncios accesibles.
 */
import React, { useEffect, useRef, useState } from 'react'

export interface Announcement {
  readonly done: number
  readonly failed: number
}

/**
 * Genera el texto de anuncio consolidado.
 * { done: 7, failed: 3 } → "7 archivos listos, 3 con error"
 */
export function announcementText(a: Announcement): string {
  const parts: string[] = []
  if (a.done > 0) parts.push(`${a.done} ${a.done === 1 ? 'archivo listo' : 'archivos listos'}`)
  if (a.failed > 0) parts.push(`${a.failed} con error`)
  return parts.join(', ')
}

export interface LiveRegionProps {
  /** Anuncio pendiente de leer. Cuando cambia, se actualiza la región. */
  announcement: Announcement | null
}

/**
 * Componente invisible que mantiene una región aria-live="polite".
 * El texto se actualiza una sola vez por lote (nunca por archivo).
 */
export function LiveRegion({ announcement }: LiveRegionProps): React.ReactElement {
  const [text, setText] = useState('')
  const prevRef = useRef<Announcement | null>(null)

  useEffect(() => {
    if (announcement === null) return
    // Solo actualiza si el anuncio cambió (evita re-anuncios del mismo lote).
    const prev = prevRef.current
    if (prev?.done === announcement.done && prev?.failed === announcement.failed) return
    prevRef.current = announcement
    setText(announcementText(announcement))
  }, [announcement])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Visualmente oculto pero accesible para lectores de pantalla.
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
      }}
      data-testid="live-region"
    >
      {text}
    </div>
  )
}
