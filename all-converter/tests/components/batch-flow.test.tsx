// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '../../src/converters/types'
import { FileQueue } from '../../src/components/FileQueue'
import { WATCHDOG_MS } from '../../src/lib/job-scheduler'
import { controlledJobs, converterCalls, queueEntry, resetBatchDoubles } from '../helpers/batch'

vi.mock('../../src/converters/registry', async () => (await import('../helpers/batch')).makeRegistryModule())

URL.createObjectURL = vi.fn(() => 'blob:zip')
URL.revokeObjectURL = vi.fn()

beforeEach(() => { resetBatchDoubles() })

const imageEntry = (name: string): FileEntry => queueEntry(name, 'image', `fotos/${name}`)
const sheetEntry = (name: string): FileEntry => queueEntry(name, 'spreadsheet', `datos/${name}`)

/** Elige el destino de una fila por el nombre del archivo (FR-023b). */
function chooseTarget(fileName: string, optionLabel: string): void {
  const select = screen.getByLabelText(fileName, { selector: 'select' })
  const option = Array.from(select.querySelectorAll('option')).find((candidate) => candidate.textContent === optionLabel)
  fireEvent.change(select, { target: { value: option!.value } })
}

/** Espera a que el conversor doble tenga colgado el archivo pedido. */
async function waitForControlled(name: string) {
  await waitFor(() => expect(controlledJobs.get(name)).toBeTruthy())
  return controlledJobs.get(name)!
}

describe('flujo de lote', () => {
  it('convierte un lote de formatos mezclados, cada archivo a su propio destino (FR-023b)', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), imageEntry('b.png'), sheetEntry('datos.csv')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('b.png', 'WEBP')
    chooseTarget('datos.csv', 'XLSX')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/b\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/datos\.csv: completed/)).toBeTruthy()
  })

  it('solo ofrece a cada archivo los destinos válidos para su tipo (FR-023b)', () => {
    render(<FileQueue entries={[imageEntry('a.png'), sheetEntry('datos.csv')]} />)
    const imageOptions = Array.from(screen.getByLabelText('a.png', { selector: 'select' }).querySelectorAll('option')).map((option) => option.textContent)
    const sheetOptions = Array.from(screen.getByLabelText('datos.csv', { selector: 'select' }).querySelectorAll('option')).map((option) => option.textContent)
    expect(imageOptions).toEqual(['Elegí un formato destino', 'JPG', 'WEBP'])
    expect(sheetOptions).toEqual(['Elegí un formato destino', 'XLSX'])
  })

  it('omite sin bloquear los archivos sin destino elegido (FR-023c)', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), sheetEntry('datos.csv')]} />)
    chooseTarget('a.png', 'JPG')
    expect(screen.getByText(/1 archivo\(s\) sin formato destino/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.queryByText(/datos\.csv: completed/)).toBeNull()
  })

  it('conserva los éxitos ante fallos parciales', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), imageEntry('malo.png')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('malo.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.getByText(/malo\.png: error/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('dañado')
  })

  it('no permite convertir sin ningún destino elegido', () => {
    render(<FileQueue entries={[imageEntry('a.png')]} />)
    expect(screen.getByRole('button', { name: 'Convertir todos' }).hasAttribute('disabled')).toBe(true)
  })

  it('no muestra panel de lote sin archivos listos', () => {
    render(<FileQueue entries={[]} />)
    expect(screen.queryByRole('button', { name: 'Convertir todos' })).toBeNull()
  })

  it('al reconvertir solo procesa los pendientes y preserva lo ya convertido', async () => {
    const { rerender } = render(<FileQueue entries={[imageEntry('a.png')]} />)
    chooseTarget('a.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeTruthy())
    expect(converterCalls).toEqual(['a.png'])

    // Llega un archivo nuevo a la cola (a.png ya está listo).
    rerender(<FileQueue entries={[imageEntry('a.png'), imageEntry('b.png')]} />)
    chooseTarget('b.png', 'JPG')
    const button = screen.getByRole('button', { name: /Convertir pendientes/ })
    expect(button.textContent).toContain('(1)')

    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText(/b\.png: completed/)).toBeTruthy())
    // a.png NO se reconvirtió (sigue una sola llamada) y quedó preservado.
    expect(converterCalls).toEqual(['a.png', 'b.png'])
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
  })

  // Defecto preexistente (T005/T006): cancelar con resultados previos dejaba `running` en true
  // para siempre, con la barra trabada en "Cancelar lote" y el botón de convertir deshabilitado.
  it('cancelar el lote habiendo resultados previos no deja la UI trabada (FR-009)', async () => {
    render(<FileQueue entries={[imageEntry('a.png'), imageEntry('control-1.png')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('control-1.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))

    // a.png ya dejó resultado; control-1.png sigue colgado y el lote está corriendo.
    await waitFor(() => expect(screen.getByText(/a\.png: completed/)).toBeTruthy())
    await waitForControlled('control-1.png')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar lote' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar lote' })).toBeNull())
    const convertButton = await screen.findByRole('button', { name: /Convertir/ })
    expect(convertButton.hasAttribute('disabled')).toBe(false)
    expect(screen.getByText(/control-1\.png: cancelled/)).toBeTruthy()
    // El resultado previo sobrevive: la descarga del ZIP sigue ofrecida.
    expect(screen.getByRole('button', { name: 'Descargar ZIP' })).toBeTruthy()
  })
})

describe('reintento por archivo (FR-013, FR-014)', () => {
  it('ofrece reintentar en el fallo transitorio y no en el determinístico', async () => {
    render(<FileQueue entries={[queueEntry('memoria.png'), queueEntry('protegido.png')]} />)
    chooseTarget('memoria.png', 'JPG')
    chooseTarget('protegido.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))

    await waitFor(() => expect(screen.getByText(/protegido\.png: error/)).toBeTruthy())
    expect(screen.getByText(/memoria\.png: error/)).toBeTruthy()

    expect(screen.getByRole('button', { name: 'Reintentar memoria.png' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reintentar protegido.png' })).toBeNull()
  })

  it('reintentar reprocesa solo ese archivo y preserva los resultados de los demás', async () => {
    render(<FileQueue entries={[queueEntry('a.png'), queueEntry('intermitente.png')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('intermitente.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))

    await waitFor(() => expect(screen.getByText(/intermitente\.png: error/)).toBeTruthy())
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(converterCalls).toEqual(['a.png', 'intermitente.png'])

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar intermitente.png' }))

    await waitFor(() => expect(screen.getByText(/intermitente\.png: completed/)).toBeTruthy())
    // Solo se reprocesó el archivo reintentado; a.png sigue listo y sin reconvertir.
    expect(converterCalls).toEqual(['a.png', 'intermitente.png', 'intermitente.png'])
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reintentar intermitente.png' })).toBeNull()
  })
})

describe('resumen del lote (FR-016)', () => {
  it('informa listos, con error y cancelados', async () => {
    render(<FileQueue entries={[queueEntry('a.png'), queueEntry('malo.png'), queueEntry('control-1.png')]} />)
    chooseTarget('a.png', 'JPG')
    chooseTarget('malo.png', 'JPG')
    chooseTarget('control-1.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))

    await waitForControlled('control-1.png')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar lote' }))

    const summary = await screen.findByText(/Lote terminado/)
    expect(summary.textContent).toContain('1 archivo listo')
    expect(summary.textContent).toContain('1 con error')
    expect(summary.textContent).toContain('1 cancelado')
    // El mismo resumen se anuncia una sola vez para lectores de pantalla.
    await waitFor(() => expect(screen.getByTestId('live-region').textContent).toContain('1 cancelado'))
  })
})

describe('watchdog por archivo (FR-015)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** Deja correr las promesas pendientes sin dejar de usar timers falsos. */
  const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

  it('aborta el archivo que deja de reportar avance y sigue con el resto', async () => {
    render(<FileQueue entries={[queueEntry('control-colgado.png'), queueEntry('a.png')]} />)
    chooseTarget('control-colgado.png', 'JPG')
    chooseTarget('a.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))

    await flush()
    expect(controlledJobs.get('control-colgado.png')).toBeTruthy()
    // El otro archivo del lote no espera al colgado.
    expect(screen.getByText(/a\.png: completed/)).toBeTruthy()

    await flush(WATCHDOG_MS)

    expect(screen.getByText(/control-colgado\.png: error/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('inactividad')
    // El vencimiento es transitorio: reintentar tiene sentido y se ofrece (FR-013).
    expect(screen.getByRole('button', { name: 'Reintentar control-colgado.png' })).toBeTruthy()
    // El lote terminó: ya no está corriendo.
    expect(screen.queryByRole('button', { name: 'Cancelar lote' })).toBeNull()
  })

  it('no aborta al archivo que sigue reportando avance', async () => {
    render(<FileQueue entries={[queueEntry('control-vivo.png')]} />)
    chooseTarget('control-vivo.png', 'JPG')
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todos' }))
    await flush()

    // Tres cuartos del plazo, un latido de progreso, y otra vez tres cuartos: sin el reinicio
    // del plazo esto ya lo habría abortado.
    await flush(WATCHDOG_MS * 0.75)
    act(() => { controlledJobs.get('control-vivo.png')!.emitProgress(50) })
    await flush(WATCHDOG_MS * 0.75)

    expect(screen.getByText(/control-vivo\.png: converting/)).toBeTruthy()

    act(() => { controlledJobs.get('control-vivo.png')!.finish() })
    await flush()
    expect(screen.getByText(/control-vivo\.png: completed/)).toBeTruthy()
  })
})
