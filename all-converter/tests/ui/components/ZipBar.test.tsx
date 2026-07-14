// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ZipBar } from '../../../src/ui/components/ZipBar'

describe('ZipBar (T041)', () => {
  it('no se renderiza con 0 archivos listos', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={0} />)
    expect(screen.queryByTestId('zip-bar')).toBeNull()
  })

  it('no se renderiza con 1 archivo listo', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={1} />)
    expect(screen.queryByTestId('zip-bar')).toBeNull()
  })

  it('se renderiza con 2 archivos listos y URL disponible', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={2} />)
    expect(screen.getByTestId('zip-bar')).toBeTruthy()
  })

  it('se renderiza con más de 2 archivos listos', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={5} />)
    expect(screen.getByTestId('zip-bar')).toBeTruthy()
  })

  it('no se renderiza si zipUrl es null aunque haya archivos', () => {
    render(<ZipBar zipUrl={null} completedCount={3} />)
    expect(screen.queryByTestId('zip-bar')).toBeNull()
  })

  it('el link de descarga tiene el href correcto', () => {
    render(<ZipBar zipUrl="blob:fake-url" completedCount={3} />)
    const link = screen.getByTestId('zip-download-link')
    expect(link.getAttribute('href')).toBe('blob:fake-url')
  })

  it('el link menciona la cantidad de archivos', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={7} />)
    expect(screen.getByTestId('zip-download-link').textContent).toContain('7')
  })

  it('la región tiene nombre accesible', () => {
    render(<ZipBar zipUrl="blob:fake" completedCount={2} />)
    expect(screen.getByRole('region', { name: /descarga/i })).toBeTruthy()
  })
})
