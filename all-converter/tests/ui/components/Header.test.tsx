// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Header } from '../../../src/ui/components/Header'

describe('Header (T039)', () => {
  it('renderiza el logo con el nombre de la app', () => {
    render(<Header />)
    expect(screen.getByTestId('logo').textContent).toContain('ConvertiTodo')
  })

  it('muestra el sello de privacidad con el texto exacto', () => {
    render(<Header />)
    expect(screen.getByTestId('privacy-badge').textContent).toContain(
      'Tus archivos nunca salen del navegador'
    )
  })

  it('el sello de privacidad tiene nombre accesible descriptivo', () => {
    render(<Header />)
    expect(
      screen.getByRole('note', { name: /nunca salen del navegador/i })
    ).toBeTruthy()
  })

  it('el header tiene role banner', () => {
    render(<Header />)
    expect(screen.getByRole('banner')).toBeTruthy()
  })
})
