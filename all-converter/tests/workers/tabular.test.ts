import { describe, expect, it } from 'vitest'
import { decodeCsv, isFlatTabularJson } from '../../src/workers/tabular'

const encode = (value: string) => new TextEncoder().encode(value).buffer

describe('parsing tabular', () => {
  it('respeta separadores, saltos y comillas escapadas dentro de campos', () => {
    const parsed = decodeCsv(encode('nombre,nota\n"Ada, Lovelace","línea 1\nlínea 2"\n"Grace ""Amazing""",ok'))
    expect(parsed.separator).toBe(',')
    expect(parsed.rows).toEqual([['nombre', 'nota'], ['Ada, Lovelace', 'línea 1\nlínea 2'], ['Grace "Amazing"', 'ok']])
  })

  it('rechaza quoting incompleto y columnas inconsistentes', () => {
    expect(() => decodeCsv(encode('a,b\n"sin cerrar,b'))).toThrow(/entrecomillado|columnas/)
    expect(() => decodeCsv(encode('a,b\n1\n2,3,4'))).toThrow('columnas consistentes')
  })

  it('acepta solo arrays de objetos planos escalares', () => {
    expect(isFlatTabularJson([{ name: 'Ada', active: true, score: 1, note: null }])).toBe(true)
    expect(isFlatTabularJson([{ name: 'Ada', nested: { value: 1 } }])).toBe(false)
    expect(isFlatTabularJson([{ name: 'Ada', list: [1] }])).toBe(false)
  })
})
