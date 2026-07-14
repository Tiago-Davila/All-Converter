/**
 * player.ts: interfaz de sonido única de la app (FR-038), desacoplada de la
 * librería concreta (cuelume). El resto de la app solo conoce playSound(evento).
 *
 * Reglas duras que este módulo garantiza:
 * - Silencio por defecto; la preferencia vive en ui-prefs (FR-031/FR-032).
 * - prefers-reduced-motion VETA el sonido aunque la preferencia esté activa (FR-034).
 * - Dos sonidos nunca se solapan: el nuevo se descarta (FR-035).
 * - Sin assets ni red: cuelume sintetiza en vivo con Web Audio (FR-037/FR-045).
 */
import { play, setEnabled, type SoundName } from 'cuelume'
import { readPrefs, writePrefs } from '../prefs/ui-prefs'
import type { SoundEvent } from './events'

/** Eventos de la spec + 'toggle' (control de sonido y selectores de formato). */
export type UiSoundEvent = SoundEvent | 'toggle'

/**
 * Mapeo evento semántico → sonido curado de cuelume.
 * Éxito = 'success', fail/error = 'bloom', toggle = 'toggle' (decisión del propietario).
 */
const CUELUME_SOUND: Readonly<Record<UiSoundEvent, SoundName>> = {
  drop: 'droplet',
  reject: 'bloom',
  'queue-done-ok': 'success',
  'queue-done-errors': 'bloom',
  hover: 'chime',
  download: 'tick',
  zip: 'sparkle',
  toggle: 'toggle',
}

/** Ventana durante la cual un nuevo sonido se descarta (FR-035: nunca solapar). */
const OVERLAP_LOCK_MS = 450

let lastPlayedAt = -Infinity

/** true si prefers-reduced-motion está activo: el sistema veta todo sonido (FR-034). */
export function soundVetoed(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  )
}

/** La preferencia guardada del usuario (no el efecto real). */
export function isSoundEnabled(): boolean {
  return readPrefs().soundEnabled
}

/** El efecto real: preferencia activa Y sin veto del sistema (FR-034b). */
export function effectiveSoundOn(): boolean {
  return isSoundEnabled() && !soundVetoed()
}

/** Sincroniza cuelume con la preferencia persistida. Llamar una vez al arrancar. */
export function initSound(): void {
  setEnabled(effectiveSoundOn())
}

/**
 * Cambia la preferencia y la persiste. La preferencia se guarda intacta aunque
 * el veto esté activo (FR-034c): vuelve a sonar sola si el usuario desactiva
 * reduce-motion en su sistema.
 */
export function setSoundEnabled(enabled: boolean): void {
  writePrefs({ soundEnabled: enabled })
  setEnabled(enabled && !soundVetoed())
}

/**
 * Reproduce el sonido del evento si la preferencia lo permite y no hay veto.
 * Si otro sonido está dentro de su ventana de reproducción, el nuevo se
 * descarta: no se encola ni se mezcla (FR-035).
 */
export function playSound(event: UiSoundEvent): void {
  if (!effectiveSoundOn()) return
  const now = Date.now()
  if (now - lastPlayedAt < OVERLAP_LOCK_MS) return
  lastPlayedAt = now
  play(CUELUME_SOUND[event])
}
