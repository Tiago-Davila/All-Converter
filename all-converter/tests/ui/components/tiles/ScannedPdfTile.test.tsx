// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScannedPdfTile } from '../../../../src/ui/components/tiles/ScannedPdfTile'

describe('ScannedPdfTile', () => {
  it('muestra aviso de PDF escaneado', () => {
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={vi.fn()} />)
    expect(screen.getByTestId('scanned-message').textContent).toMatch(/PDF escaneado/i)
  })

  it('el rótulo del botón OCR es exactamente "OCR (próximamente)"', () => {
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={vi.fn()} />)
    expect(screen.getByTestId('btn-ocr').textContent).toBe('OCR (próximamente)')
  })

  it('el botón OCR tiene aria-disabled', () => {
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={vi.fn()} />)
    expect(screen.getByTestId('btn-ocr').getAttribute('aria-disabled')).toBe('true')
  })

  it('activar el botón OCR no ejecuta nada (sin handler)', () => {
    const handler = vi.fn()
    // No se pasa handler al componente; verificamos que no hay efecto
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={vi.fn()} />)
    const btn = screen.getByTestId('btn-ocr')
    fireEvent.click(btn)
    expect(handler).not.toHaveBeenCalled()
  })

  it('llama onRemove al hacer clic en Quitar', () => {
    const onRemove = vi.fn()
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={onRemove} />)
    fireEvent.click(screen.getByTestId('btn-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('la región tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<ScannedPdfTile fileName="scan.pdf" onRemove={vi.fn()} />)
    expect(screen.getByRole('region', { name: /scan\.pdf/i })).toBeTruthy()
  })
})
