import { describe, expect, it } from 'vitest'
import {
  RESIZE_LONG,
  RESIZE_MIN,
  RESIZE_SHORT,
  clampAxis,
  initialPair,
  isValidPair,
  linkedPair,
  maxForAxis,
} from '../../src/lib/image-resize'

const ratio = ({ width, height }: { width: number; height: number }) => width / height

describe('isValidPair', () => {
  it('acepta los tres topes por orientación', () => {
    expect(isValidPair(1920, 1080)).toBe(true)
    expect(isValidPair(1080, 1920)).toBe(true)
    expect(isValidPair(1080, 1080)).toBe(true)
  })

  it('rechaza pasarse del lado largo o del lado corto', () => {
    expect(isValidPair(1921, 1080)).toBe(false)
    expect(isValidPair(1920, 1081)).toBe(false)
    expect(isValidPair(1200, 1200)).toBe(false)
  })

  it('rechaza por debajo del mínimo y valores no enteros', () => {
    expect(isValidPair(RESIZE_MIN - 1, 100)).toBe(false)
    expect(isValidPair(100, RESIZE_MIN - 1)).toBe(false)
    expect(isValidPair(100.5, 100)).toBe(false)
  })
})

describe('maxForAxis', () => {
  it('deja llegar al lado largo mientras el otro eje no pase el corto', () => {
    expect(maxForAxis(1080)).toBe(RESIZE_LONG)
    expect(maxForAxis(500)).toBe(RESIZE_LONG)
  })

  it('degrada a lado corto cuando el otro eje ya es el largo', () => {
    expect(maxForAxis(1081)).toBe(RESIZE_SHORT)
    expect(maxForAxis(1920)).toBe(RESIZE_SHORT)
  })
})

describe('clampAxis (proporción desactivada, FR-006)', () => {
  it('respeta el tope según el otro eje sin tocarlo', () => {
    expect(clampAxis(4000, 800)).toBe(RESIZE_LONG)
    expect(clampAxis(4000, 1500)).toBe(RESIZE_SHORT)
  })

  it('sube al mínimo y redondea', () => {
    expect(clampAxis(10, 800)).toBe(RESIZE_MIN)
    expect(clampAxis(500.6, 800)).toBe(501)
  })

  it('cae al mínimo con entradas vacías o absurdas', () => {
    expect(clampAxis(Number.NaN, 800)).toBe(RESIZE_MIN)
    expect(clampAxis(0, 800)).toBe(RESIZE_MIN)
    expect(clampAxis(-20, 800)).toBe(RESIZE_MIN)
  })

  it('permite cualquier par que salga de sus propios topes', () => {
    const height = 1500
    expect(isValidPair(clampAxis(4000, height), height)).toBe(true)
  })
})

describe('linkedPair (proporción activa, FR-005)', () => {
  const natural = { width: 3024, height: 4032 } // foto de celular, 3:4

  it('deriva el otro eje conservando la proporción', () => {
    expect(linkedPair('width', 1080, natural)).toEqual({ width: 1080, height: 1440 })
    expect(linkedPair('height', 1440, natural)).toEqual({ width: 1080, height: 1440 })
  })

  it('encoge el par completo cuando el derivado se pasa del tope', () => {
    // 1500 de ancho pediría 2000 de alto: se encoge hasta 1080×1440.
    const pair = linkedPair('width', 1500, natural)
    expect(pair).toEqual({ width: 1080, height: 1440 })
    expect(isValidPair(pair.width, pair.height)).toBe(true)
  })

  it('permite agrandar hasta el tope (FR-008)', () => {
    const chica = { width: 200, height: 150 }
    // 1920 de ancho pediría 1440 de alto, que pasa el lado corto: se topea en 1440×1080.
    expect(linkedPair('width', 1920, chica)).toEqual({ width: 1440, height: 1080 })
    expect(linkedPair('width', 1000, chica)).toEqual({ width: 1000, height: 750 })
  })

  it('mantiene la relación de aspecto dentro de 1 px de redondeo', () => {
    const raro = { width: 1333, height: 777 }
    const pair = linkedPair('width', 900, raro)
    expect(Math.abs(ratio(pair) - ratio(raro))).toBeLessThan(0.01)
    expect(isValidPair(pair.width, pair.height)).toBe(true)
  })

  it('nunca devuelve un par inválido, edite el eje que edite', () => {
    for (const nat of [{ width: 4000, height: 3000 }, { width: 300, height: 4000 }, { width: 900, height: 900 }]) {
      for (const value of [RESIZE_MIN, 100, 1080, 1920, 5000]) {
        for (const axis of ['width', 'height'] as const) {
          const pair = linkedPair(axis, value, nat)
          expect(isValidPair(pair.width, pair.height)).toBe(true)
        }
      }
    }
  })

  it('con proporción imposible gana el máximo sobre el mínimo', () => {
    // 4000×50: para que el alto llegue a 32 el ancho necesitaría 2560 > 1920.
    const pair = linkedPair('width', 4000, { width: 4000, height: 50 })
    expect(pair.width).toBe(RESIZE_LONG)
    expect(pair.height).toBeLessThan(RESIZE_MIN)
    expect(Math.max(pair.width, pair.height)).toBeLessThanOrEqual(RESIZE_LONG)
  })
})

describe('initialPair', () => {
  it('topea paisaje, retrato y cuadrado en su límite propio', () => {
    expect(initialPair({ width: 3000, height: 2000 })).toEqual({ width: 1620, height: 1080 })
    expect(initialPair({ width: 2000, height: 3000 })).toEqual({ width: 1080, height: 1620 })
    expect(initialPair({ width: 2000, height: 2000 })).toEqual({ width: 1080, height: 1080 })
  })

  it('deja intacta una imagen que ya entra', () => {
    expect(initialPair({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 })
  })

  it('sube al mínimo un ícono diminuto', () => {
    expect(initialPair({ width: 16, height: 16 })).toEqual({ width: RESIZE_MIN, height: RESIZE_MIN })
  })
})
