import { describe, expect, it } from 'vitest'
import { classifyError, makeRowError, CANCELLED_ERROR, ENGINE_LOAD_ERROR } from '../../../src/ui/components/error-class'

describe('classifyError — determinísticos NO ofrecen reintento (FR-019c)', () => {
  it('archivo corrupto → deterministic', () =>
    expect(classifyError('archivo corrupto o dañado')).toBe('deterministic'))

  it('formato no soportado (español) → deterministic', () =>
    expect(classifyError('Formato no soportado para esta conversión')).toBe('deterministic'))

  it('formato unsupported (inglés) → deterministic', () =>
    expect(classifyError('Unsupported file type')).toBe('deterministic'))

  it('tamaño excedido → deterministic', () =>
    expect(classifyError('El tamaño del archivo supera el límite')).toBe('deterministic'))

  it('size exceed (inglés) → deterministic', () =>
    expect(classifyError('File size exceeds the maximum allowed')).toBe('deterministic'))

  it('too large → deterministic', () =>
    expect(classifyError('File too large to convert')).toBe('deterministic'))

  it('PDF escaneado (español) → deterministic', () =>
    expect(classifyError('PDF escaneado sin capa de texto')).toBe('deterministic'))

  it('scanned PDF (inglés) → deterministic', () =>
    expect(classifyError('Scanned PDF: no text layer found')).toBe('deterministic'))
})

describe('classifyError — transitorios SÍ ofrecen reintento (FR-019b)', () => {
  it('memoria insuficiente → transient', () =>
    expect(classifyError('memoria insuficiente durante la conversión')).toBe('transient'))

  it('out of memory → transient', () =>
    expect(classifyError('Out of memory')).toBe('transient'))

  it('fallo del motor → transient', () =>
    expect(classifyError('el motor de conversión falló inesperadamente')).toBe('transient'))

  it('error genérico del worker → transient', () =>
    expect(classifyError('Worker crashed')).toBe('transient'))
})

describe('cancelación y fallo del motor son siempre transitorios', () => {
  it('CANCELLED_ERROR es transient', () =>
    expect(CANCELLED_ERROR.errorClass).toBe('transient'))

  it('CANCELLED_ERROR tiene mensaje correcto', () =>
    expect(CANCELLED_ERROR.message).toBe('cancelado por vos'))

  it('ENGINE_LOAD_ERROR es transient', () =>
    expect(ENGINE_LOAD_ERROR.errorClass).toBe('transient'))

  it('ENGINE_LOAD_ERROR tiene mensaje correcto', () =>
    expect(ENGINE_LOAD_ERROR.message).toBe('no se pudo cargar el conversor'))
})

describe('makeRowError construye RowError completo', () => {
  it('propaga el mensaje original', () => {
    const e = makeRowError('corrupto')
    expect(e.message).toBe('corrupto')
  })

  it('clasifica correctamente al construir', () => {
    expect(makeRowError('corrupto').errorClass).toBe('deterministic')
    expect(makeRowError('memoria insuficiente').errorClass).toBe('transient')
  })
})
