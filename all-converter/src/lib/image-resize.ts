/**
 * image-resize.ts: matemática pura del redimensionador (003, FR-005 a FR-008).
 * Sin DOM, sin React, sin canvas → testeable en Vitest node.
 *
 * La UI (ResizePage) y el worker (image.worker.ts vía validation.ts) comparten
 * este módulo, así que el invariante del par de salida se define una sola vez.
 *
 * Invariante (FR-007), sobre el PAR de salida, no sobre la orientación de la fuente:
 *
 * | Regla                | Valor |
 * |----------------------|-------|
 * | mínimo por eje       | 32    |
 * | lado largo máximo    | 1920  |
 * | lado corto máximo    | 1080  |
 *
 * De ahí salen los tres casos: paisaje hasta 1920×1080, retrato hasta 1080×1920
 * y cuadrado hasta 1080×1080.
 *
 * Precedencia en conflictos: cuando la proporción original hace imposible cumplir
 * mínimo y máximo a la vez (p. ej. 4000×50), **gana el máximo** y el eje derivado
 * queda por debajo de 32. La página lo avisa en vez de bloquear.
 */

export const RESIZE_MIN = 32
export const RESIZE_LONG = 1920
export const RESIZE_SHORT = 1080

export interface Dimensions {
  width: number
  height: number
}

export type ResizeAxis = 'width' | 'height'

/** Invariante del par de salida (FR-007). */
export function isValidPair(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (width < RESIZE_MIN || height < RESIZE_MIN) return false
  return Math.max(width, height) <= RESIZE_LONG && Math.min(width, height) <= RESIZE_SHORT
}

/**
 * Tope del eje que se está editando, dado el valor del otro eje.
 * Si el otro eje ya pasó el lado corto, este eje pasa a ser el corto.
 */
export function maxForAxis(other: number): number {
  return other > RESIZE_SHORT ? RESIZE_SHORT : RESIZE_LONG
}

/** Reduce el par al invariante recortando cada eje según su rol (largo/corto). */
function enforceMax(width: number, height: number): Dimensions {
  return width >= height
    ? { width: Math.min(width, RESIZE_LONG), height: Math.min(height, RESIZE_SHORT) }
    : { width: Math.min(width, RESIZE_SHORT), height: Math.min(height, RESIZE_LONG) }
}

/**
 * Modo libre (FR-006): clampea un eje sin tocar el otro.
 * Un valor vacío o inválido cae al mínimo.
 */
export function clampAxis(value: number, other: number): number {
  if (!Number.isFinite(value) || value <= 0) return RESIZE_MIN
  return Math.max(RESIZE_MIN, Math.min(maxForAxis(other), Math.round(value)))
}

/**
 * Encoge el par hasta que entre en el invariante, conservando la proporción.
 * Solo achica (nunca agranda para llenar el tope) y después intenta crecer si
 * el lado corto quedó por debajo del mínimo — salvo que crecer rompa el máximo,
 * porque el máximo gana.
 */
function fitPair(width: number, height: number): Dimensions {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const scale = Math.min(1, RESIZE_LONG / long, RESIZE_SHORT / short)
  let w = width * scale
  let h = height * scale

  const shortNow = Math.min(w, h)
  if (shortNow < RESIZE_MIN) {
    const grow = RESIZE_MIN / shortNow
    const grownLong = Math.max(w, h) * grow
    const grownShort = shortNow * grow
    if (grownLong <= RESIZE_LONG && grownShort <= RESIZE_SHORT) {
      w *= grow
      h *= grow
    }
  }

  return enforceMax(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
}

/**
 * Modo proporción (FR-005): el usuario edita un eje y el otro se deriva de la
 * relación de aspecto de la fuente; después el par se encoge hasta entrar en el
 * invariante.
 */
export function linkedPair(axis: ResizeAxis, value: number, natural: Dimensions): Dimensions {
  if (natural.width <= 0 || natural.height <= 0) return { width: RESIZE_MIN, height: RESIZE_MIN }
  const input = Number.isFinite(value) && value > 0 ? value : RESIZE_MIN
  return axis === 'width'
    ? fitPair(input, (input * natural.height) / natural.width)
    : fitPair((input * natural.width) / natural.height, input)
}

/**
 * Sugerencia al cargar la imagen: sus dimensiones reales si ya entran en el
 * invariante, o el mayor par proporcional que entre.
 */
export function initialPair(natural: Dimensions): Dimensions {
  if (natural.width <= 0 || natural.height <= 0) return { width: RESIZE_MIN, height: RESIZE_MIN }
  return fitPair(natural.width, natural.height)
}
