/**
 * StaticBackground: fallback de gradiente CSS cuando no hay WebGL,
 * al perder el contexto, o bajo prefers-reduced-motion (T030, FR-004, US3).
 * Misma paleta del mockup: #0b0c11 → #5b5bd6 (indigo/violet).
 * Sin animación, sin canvas, sin errores visibles al usuario (invariante 2).
 */
import React from 'react'

export function StaticBackground(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      data-testid="static-background"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1,
        background: 'radial-gradient(ellipse 80% 80% at 38% 32%, #5b5bd6 0%, #7b7bef 30%, #0b0c11 100%)',
      }}
    />
  )
}
