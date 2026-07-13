/**
 * Matriz de degradación (research.md §D6): un único lugar decide qué se degrada;
 * los componentes solo leen `DegradationPlan`, nunca ramifican por su cuenta.
 *
 * Invariante: la funcionalidad es 100% en cualquier combinación de capacidades.
 * Ninguna fila de la matriz quita una capacidad del producto, solo adorno visual
 * o sonoro (Constitución XIV).
 */
export interface Capabilities {
  readonly webgl: boolean
  readonly webAudio: boolean
  readonly reducedMotion: boolean
}

export type BackgroundMode = 'shader' | 'static'

export interface DegradationPlan {
  readonly background: BackgroundMode
  readonly soundAllowed: boolean
}

export function planFor(caps: Capabilities): DegradationPlan {
  return {
    background: caps.webgl && !caps.reducedMotion ? 'shader' : 'static',
    soundAllowed: caps.webAudio && !caps.reducedMotion,
  }
}

function detectWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function detectWebAudio(): boolean {
  return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window)
}

function detectReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Detecta las capacidades reales del navegador en tiempo de ejecución. */
export function detectCapabilities(): Capabilities {
  return { webgl: detectWebgl(), webAudio: detectWebAudio(), reducedMotion: detectReducedMotion() }
}
