import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { makeImageFolder } from '../helpers/large-folder'

const COUNT = 60

/**
 * US1 + US3 de punta a punta: una carpeta de 60 imágenes entra, se convierte, se pausa a mitad,
 * se reanuda y el ZIP que baja tiene las 60 entradas (006 T042).
 */
test('lote de 60 archivos: convertir, pausar, reanudar y descargar el ZIP completo', async ({ page }) => {
  const folder = await makeImageFolder(COUNT)
  const folderName = path.basename(folder)

  // Sin File System Access el ZIP se entrega como descarga común, que es la que Playwright
  // puede leer; el diálogo nativo de `showSaveFilePicker` no se puede manejar desde el test.
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker })
  await page.goto('/')

  await page.locator('input[webkitdirectory]').setInputFiles(folder)
  await expect(page.getByText(`${COUNT} archivos · 1 carpeta`)).toBeVisible()

  // Un solo selector aplica el destino a las 60 imágenes de la carpeta.
  await page.getByLabel(`Formato para todas las imágenes de ${folderName}`).selectOption('image-convert::jpg')
  await page.getByRole('button', { name: 'Convertir todos' }).click()

  await page.getByRole('button', { name: 'Pausar lote' }).click()
  await expect(page.getByText('Pausado').first()).toBeVisible()
  await page.getByRole('button', { name: 'Reanudar lote' }).click()

  const zipButton = page.getByRole('button', { name: 'Descargar ZIP', exact: true })
  await expect(zipButton).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(`Lote terminado: ${COUNT} archivos listos.`)).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download'), zipButton.click()])
  const zip = await JSZip.loadAsync(await readFile(await download.path()))
  const names = Object.keys(zip.files)
  expect(names).toHaveLength(COUNT)
  expect(names.every((name) => name.startsWith(`${folderName}/`) && name.endsWith('.jpg'))).toBe(true)
})
