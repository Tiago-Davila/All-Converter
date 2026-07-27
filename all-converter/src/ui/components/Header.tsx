/**
 * Header: cabecera con logo, control de sonido y sello de privacidad (T039, US3).
 * El sello es parte del requisito de transparencia (FR-045, Principio II):
 * "Tus archivos nunca salen del navegador" debe ser visible en todo momento.
 *
 * El control de sonido (FR-031): silenciado por defecto, alcanzable por teclado,
 * estado evidente sin depender del color (ícono distinto + texto). Bajo
 * prefers-reduced-motion muestra el efecto real (silenciado) y el motivo (FR-034b).
 */
import React, { useState } from 'react'
import { Icon } from './icons'
import { RESIZE_HASH, useHashRoute } from '../routing'
import { isSoundEnabled, setSoundEnabled, soundVetoed, playSound } from '../sound/player'

function SoundToggle(): React.ReactElement {
  const [enabled, setEnabled] = useState(() => isSoundEnabled())
  const vetoed = soundVetoed()
  const effective = enabled && !vetoed

  const label = effective
    ? 'Sonido activado'
    : vetoed && enabled
      ? 'Sonido silenciado por tu preferencia de menos movimiento'
      : 'Sonido silenciado'

  return (
    <button
      type="button"
      className="ct-sound-toggle"
      data-testid="sound-toggle"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      onClick={() => {
        const next = !enabled
        setEnabled(next)
        setSoundEnabled(next)
        if (next) playSound('toggle')
      }}
    >
      <Icon name={effective ? 'sound-on' : 'sound-off'} size={15} />
      <span className="ct-sound-toggle-label">
        {effective ? 'Sonido' : 'Silenciado'}
      </span>
    </button>
  )
}

export function Header(): React.ReactElement {
  const route = useHashRoute()

  return (
    <header className="ct-header" data-testid="app-header" role="banner">
      <div className="ct-brand" data-testid="logo" aria-label="ConvertiTodo">
        <span className="ct-brand-mark" aria-hidden="true">
          <Icon name="refresh" size={19} />
        </span>
        <span className="ct-brand-text">
          <span className="ct-brand-name">ConvertiTodo</span>
          <span className="ct-brand-sub"></span>
        </span>
      </div>
      <div className="ct-header-right">
        {/* Alcanzable también con archivos en la cola; oculto en la página propia (003 FR-015). */}
        {route !== 'resize' && (
          <a className="ct-nav-link" href={RESIZE_HASH} data-testid="nav-resize">
            <Icon name="img" size={14} />
            Redimensionar
          </a>
        )}
        <SoundToggle />
        <span
          className="ct-privacy-pill"
          data-testid="privacy-badge"
          role="note"
          aria-label="Privacidad: tus archivos nunca salen del navegador"
        >
          <Icon name="shield" size={14} className="ct-icn-shield" />
          <span>Tus archivos nunca salen del navegador</span>
        </span>
      </div>
    </header>
  )
}
