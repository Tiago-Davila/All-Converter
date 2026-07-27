/**
 * routing.ts: ruteo por hash, sin dependencias (003 FR-015).
 *
 * El proyecto no tiene router y Claude.md prohíbe sumar dependencias sin
 * justificarlas: react-router no se justifica para dos vistas. El hash alcanza,
 * es enlazable y recargable, y deja usar <a href="#/..."> como navegación —
 * así ningún componente necesita props de ruteo.
 */
import { useSyncExternalStore } from 'react'

export type Route = 'home' | 'resize'

export const RESIZE_HASH = '#/redimensionar'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function currentRoute(): Route {
  return window.location.hash === RESIZE_HASH ? 'resize' : 'home'
}

/** En SSR/tests sin window el default es la portada. */
export function useHashRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, () => 'home')
}
