// @vitest-environment jsdom
/**
 * PasswordPrompt: tile para archivos protegidos por contraseña.
 * Muestra input de contraseña con nota de uso solo local, acciones
 * Desbloquear/Quitar, y camino de contraseña incorrecta (FR-027, US2).
 */
import React, { useState } from 'react'

export interface PasswordPromptProps {
  fileName: string
  /** Si la contraseña anterior fue incorrecta. */
  wrongPassword?: boolean
  onUnlock: (password: string) => void
  onRemove: () => void
}

export function PasswordPrompt({
  fileName,
  wrongPassword = false,
  onUnlock,
  onRemove,
}: PasswordPromptProps): React.ReactElement {
  const [password, setPassword] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length > 0) onUnlock(password)
  }

  return (
    <div data-testid="password-prompt" role="region" aria-label={`Contraseña requerida para ${fileName}`}>
      <p data-testid="privacy-note">
        La contraseña se usa solo en tu navegador. No sale de tu máquina.
      </p>
      {wrongPassword && (
        <p role="alert" data-testid="wrong-password-alert">
          Contraseña incorrecta. Intentá de nuevo.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <label htmlFor={`pwd-${fileName}`}>Contraseña</label>
        <input
          id={`pwd-${fileName}`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          data-testid="password-input"
        />
        <button type="submit" disabled={password.length === 0} data-testid="btn-unlock">
          Desbloquear
        </button>
      </form>
      <button type="button" onClick={onRemove} data-testid="btn-remove">
        Quitar
      </button>
    </div>
  )
}
