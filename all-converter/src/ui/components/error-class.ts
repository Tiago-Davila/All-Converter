/**
 * Clasificación de errores: decide si se ofrece "Reintentar" (FR-019b/c).
 *
 * - transient: el reintento puede tener éxito (memoria, motor, cancelación).
 * - deterministic: reintentar daría el mismo resultado (corrupto, no soportado,
 *   tamaño excedido, PDF escaneado sin texto). Ofrecer reintento sería mentir.
 *
 * data-model.md §Clase de error.
 */

export type ErrorClass = 'transient' | 'deterministic'

export interface RowError {
  readonly message: string
  readonly errorClass: ErrorClass
}

/**
 * Palabras clave que identifican errores determinísticos.
 * El texto llega de los conversores de 001; esta función lo clasifica.
 */
const DETERMINISTIC_PATTERNS: readonly RegExp[] = [
  /corrupt/i,
  /no soportad/i,
  /unsupported/i,
  /tamaño/i,
  /size.*exceed/i,
  /exceed.*size/i,
  /too large/i,
  /escaneado/i,
  /scanned/i,
  /no.*texto/i,
  /no.*text.*layer/i,
  /password/i,
  /contraseña/i,
]

/**
 * Clasifica un mensaje de error como transitorio o determinístico.
 *
 * Casos explícitamente transitorios: memoria insuficiente, fallo del motor,
 * cancelación previa (FR-019b). Todos los demás son determinísticos salvo que
 * los patrones de determinístico tampoco coincidan (por seguridad, cualquier
 * mensaje no clasificado se trata como transitorio).
 */
export function classifyError(message: string): ErrorClass {
  if (DETERMINISTIC_PATTERNS.some((p) => p.test(message))) return 'deterministic'
  return 'transient'
}

/**
 * Causas canónicas que siempre son transitorias (para cancelación y fallo del
 * motor cargando, que no provienen de un mensaje de conversor).
 */
export const CANCELLED_ERROR: RowError = {
  message: 'cancelado por vos',
  errorClass: 'transient',
}

export const ENGINE_LOAD_ERROR: RowError = {
  message: 'no se pudo cargar el conversor',
  errorClass: 'transient',
}

/** Construye un RowError desde el string que viene del conversor. */
export function makeRowError(message: string): RowError {
  return { message, errorClass: classifyError(message) }
}
