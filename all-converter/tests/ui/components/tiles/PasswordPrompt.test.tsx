// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PasswordPrompt } from '../../../../src/ui/components/tiles/PasswordPrompt'

describe('PasswordPrompt', () => {
  it('muestra nota de privacidad local', () => {
    render(<PasswordPrompt fileName="doc.pdf" onUnlock={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByTestId('privacy-note').textContent).toMatch(/solo en tu navegador/i)
  })

  it('no muestra alerta de contraseña incorrecta por defecto', () => {
    render(<PasswordPrompt fileName="doc.pdf" onUnlock={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.queryByTestId('wrong-password-alert')).toBeNull()
  })

  it('muestra alerta cuando wrongPassword=true', () => {
    render(<PasswordPrompt fileName="doc.pdf" wrongPassword onUnlock={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByTestId('wrong-password-alert')).toBeTruthy()
  })

  it('botón Desbloquear deshabilitado si el campo está vacío', () => {
    render(<PasswordPrompt fileName="doc.pdf" onUnlock={vi.fn()} onRemove={vi.fn()} />)
    expect((screen.getByTestId('btn-unlock') as HTMLButtonElement).disabled).toBe(true)
  })

  it('llama onUnlock con la contraseña al enviar', () => {
    const onUnlock = vi.fn()
    render(<PasswordPrompt fileName="doc.pdf" onUnlock={onUnlock} onRemove={vi.fn()} />)
    fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByTestId('btn-unlock'))
    expect(onUnlock).toHaveBeenCalledWith('secret')
  })

  it('llama onRemove al hacer clic en Quitar', () => {
    const onRemove = vi.fn()
    render(<PasswordPrompt fileName="doc.pdf" onUnlock={vi.fn()} onRemove={onRemove} />)
    fireEvent.click(screen.getByTestId('btn-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<PasswordPrompt fileName="informe.pdf" onUnlock={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByRole('region', { name: /informe\.pdf/i })).toBeTruthy()
  })
})
