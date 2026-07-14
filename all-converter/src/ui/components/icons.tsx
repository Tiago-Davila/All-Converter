/**
 * icons.tsx: sprite SVG de la identidad visual (DEP-001, mockup versionado).
 * Los símbolos vienen 1:1 del mockup; se inyectan una vez (IconSprite) y cada
 * ícono se referencia con <use>. Trazo actual (stroke: currentColor) para que
 * el color venga del contexto y nunca sea el único canal de información (FR-044).
 */
import React from 'react'

export type IconName =
  | 'shield'
  | 'img'
  | 'doc'
  | 'video'
  | 'audio'
  | 'folder'
  | 'upload'
  | 'download'
  | 'check'
  | 'x'
  | 'alert'
  | 'chev'
  | 'zip'
  | 'refresh'
  | 'info'
  | 'spin'
  | 'sound-on'
  | 'sound-off'

/** Sprite global: renderizar una sola vez, arriba del árbol. */
export function IconSprite(): React.ReactElement {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></symbol>
      <symbol id="i-img" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5" /><circle cx="9" cy="9" r="1.6" /><path d="M5 17l4-4 3 3 3-4 4 5" /></symbol>
      <symbol id="i-doc" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8.5 13h7M8.5 16.5h5" /></symbol>
      <symbol id="i-video" viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="M16 10l5-3v10l-5-3z" /></symbol>
      <symbol id="i-audio" viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></symbol>
      <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></symbol>
      <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 13l4 4 10-11" /></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.2" /></symbol>
      <symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></symbol>
      <symbol id="i-zip" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 9v2M12 13v2" /></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2" /><path d="M18 4v5h-5M6 20v-5h5" /></symbol>
      <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.2" /></symbol>
      <symbol id="i-spin" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9" /></symbol>
      <symbol id="i-sound-on" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></symbol>
      <symbol id="i-sound-off" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" /></symbol>
    </svg>
  )
}

export interface IconProps {
  name: IconName
  /** Tamaño en px (ancho = alto). */
  size?: number
  className?: string
}

/** Ícono decorativo por defecto (aria-hidden): el texto acompaña siempre (FR-042). */
export function Icon({ name, size = 16, className }: IconProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className ? `ct-icn ${className}` : 'ct-icn'}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#i-${name}`} />
    </svg>
  )
}
