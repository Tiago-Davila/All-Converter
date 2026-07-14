/**
 * Fuente de verdad del contraste (research.md §D1/§D2). El test de la puerta de
 * accesibilidad (T004) itera estos tokens contra SURFACE y falla el build si alguno
 * no cumple WCAG AA.
 */
export type ColorToken =
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'accent-violet'
  | 'accent-warm'
  | 'state-pending'
  | 'state-prep'
  | 'state-converting'
  | 'state-done'
  | 'state-error'
  | 'focus-ring'

/** Base del tema oscuro (spec FR-001). */
export const BASE = '#0b0c11'

/**
 * Scrim (research §D1): superficie efectiva bajo el contenido, compuesta con
 * alfa >= 0.85 sobre el peor pico de brillo posible del shader. El contraste se
 * mide contra esta superficie, no contra BASE, porque es lo que garantiza AA
 * "en el peor fotograma" (FR-007 / SC-002) de forma determinista.
 */
export const SURFACE = '#161521'

/** Umbral mínimo de contraste por tipo de uso (WCAG 2.1 AA). */
export const MIN_CONTRAST: Record<'text' | 'ui', number> = { text: 4.5, ui: 3.0 }

/** Tokens que se miden contra el umbral "ui" (3:1) en vez de "text" (4.5:1). */
export const UI_TOKENS: readonly ColorToken[] = ['focus-ring']

export const TOKENS: Readonly<Record<ColorToken, string>> = {
  'text-primary': '#f2f4f8',
  'text-secondary': '#a8b0c0',
  'text-muted': '#7d8598',
  'accent-violet': '#b39dff',
  'accent-warm': '#ffb37a',
  'state-pending': '#9aa3b5',
  'state-prep': '#ffd479',
  'state-converting': '#7cc4ff',
  'state-done': '#6ee7a8',
  'state-error': '#ff8a8a',
  'focus-ring': '#8b7cf0',
}
