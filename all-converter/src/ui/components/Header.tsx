/**
 * Header: cabecera con logo y sello de privacidad visible (T039, US3).
 * El sello es parte del requisito de transparencia (FR-045, Principio II):
 * "Tus archivos nunca salen del navegador" debe ser visible en todo momento.
 * Depende de T005 (tema oscuro / tokens).
 */
import React from 'react'

export function Header(): React.ReactElement {
  return (
    <header data-testid="app-header" role="banner">
      <div data-testid="logo" aria-label="ConvertiTodo">
        <span aria-hidden="true">⇄</span>
        <span>ConvertiTodo</span>
      </div>
      <div
        data-testid="privacy-badge"
        role="note"
        aria-label="Privacidad: tus archivos nunca salen del navegador"
      >
        <span aria-hidden="true">🔒</span>
        <span>Tus archivos nunca salen del navegador</span>
      </div>
    </header>
  )
}
