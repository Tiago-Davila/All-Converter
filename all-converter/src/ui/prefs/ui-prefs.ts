/**
 * Preferencias de UI persitidas en localStorage.
 *
 * Clave única: convertitodo:ui-prefs
 * Solo se persiste { soundEnabled: boolean }. Nunca datos de archivos (Principio II, FR-046).
 */

export const PREFS_KEY = 'convertitodo:ui-prefs'

/** Lo ÚNICO que se persiste. Nunca datos de archivos (Principio II, FR-046). */
export interface UiPrefs {
  readonly soundEnabled: boolean // default: false (silencio por defecto, FR-031)
}

export const DEFAULT_PREFS: UiPrefs = { soundEnabled: false }

/**
 * Lee las preferencias desde localStorage.
 * Ante valor ausente, corrupto, ilegible o localStorage no disponible
 * (modo privado, cuota llena) → DEFAULT_PREFS, sin error visible (FR-032b).
 */
export function readPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw === null) return DEFAULT_PREFS

    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'soundEnabled' in parsed &&
      typeof (parsed as Record<string, unknown>).soundEnabled === 'boolean'
    ) {
      return { soundEnabled: (parsed as Record<string, unknown>).soundEnabled as boolean }
    }
    return DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

/**
 * Persiste las preferencias en localStorage.
 * Un fallo de almacenamiento se traga en silencio (invariante 4).
 */
export function writePrefs(prefs: UiPrefs): void {
  try {
    // Solo se serializa soundEnabled: nunca propaga claves extra
    const toStore: UiPrefs = { soundEnabled: prefs.soundEnabled }
    localStorage.setItem(PREFS_KEY, JSON.stringify(toStore))
  } catch {
    // Silencio intencional: modo privado, cuota llena, etc.
  }
}
