// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PartialFidelityNote } from '../../../../src/ui/components/tiles/PartialFidelityNote'

describe('PartialFidelityNote', () => {
  it('muestra aviso de fidelidad parcial', () => {
    render(<PartialFidelityNote fileName="informe.docx" conversionLabel="DOCX → PDF" />)
    expect(screen.getByTestId('fidelity-message').textContent).toMatch(/puede variar levemente/i)
  })

  it('menciona la conversión específica', () => {
    render(<PartialFidelityNote fileName="informe.docx" conversionLabel="DOCX → PDF" />)
    expect(screen.getByTestId('fidelity-message').textContent).toContain('DOCX → PDF')
  })

  it('menciona el nombre del archivo', () => {
    render(<PartialFidelityNote fileName="informe.docx" conversionLabel="DOCX → PDF" />)
    expect(screen.getByTestId('fidelity-message').textContent).toContain('informe.docx')
  })

  it('la nota tiene nombre accesible que incluye el nombre del archivo', () => {
    render(<PartialFidelityNote fileName="reporte.pdf" conversionLabel="PDF → DOCX" />)
    expect(screen.getByRole('note', { name: /reporte\.pdf/i })).toBeTruthy()
  })

  it('funciona también para la dirección inversa PDF → DOCX', () => {
    render(<PartialFidelityNote fileName="reporte.pdf" conversionLabel="PDF → DOCX" />)
    expect(screen.getByTestId('fidelity-message').textContent).toContain('PDF → DOCX')
  })
})
