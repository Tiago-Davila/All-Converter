import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const fixture = (name: string) => path.resolve('tests/fixtures', name)

/** sample.png mide 400×300 (4:3). */
async function open(page: Page) {
  await page.goto('/#/redimensionar')
  await page.getByTestId('resize-input').setInputFiles(fixture('sample.png'))
  await expect(page.getByTestId('resize-width')).toHaveValue('400')
  await expect(page.getByTestId('resize-height')).toHaveValue('300')
}

/** Fija un eje y espera a que el par quede canónico. */
async function setAxis(page: Page, axis: 'width' | 'height', value: number) {
  const field = page.getByTestId(`resize-${axis}`)
  await field.fill(String(value))
  await field.blur()
}

/** Genera el resultado y devuelve sus bytes reales. */
async function download(page: Page) {
  await page.getByTestId('resize-go').click()
  const link = page.getByTestId('resize-download')
  await expect(link).toBeVisible()
  return Buffer.from(await link.evaluate(async (element: HTMLAnchorElement) => [
    ...new Uint8Array(await (await fetch(element.href)).arrayBuffer()),
  ]))
}

async function dimensionsOf(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(async ([data, type]) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data as number[])], { type: type as string }))
    const value = [bitmap.width, bitmap.height]
    bitmap.close()
    return value
  }, [[...bytes], mime] as const)
}

test('003 se llega a la página desde la portada', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('btn-resize').click()
  await expect(page).toHaveURL(/#\/redimensionar$/)
  await expect(page.getByRole('heading', { name: 'Redimensionar imagen' })).toBeVisible()
})

test('003 muestra las dimensiones originales y redimensiona manteniendo la proporción', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('resize-source')).toContainText('400 × 300')

  await setAxis(page, 'width', 200)
  await expect(page.getByTestId('resize-height')).toHaveValue('150')

  const bytes = await download(page)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(await dimensionsOf(page, bytes, 'image/png')).toEqual([200, 150])
})

test('003 permite alto y ancho libres cuando se apaga la proporción', async ({ page }) => {
  await open(page)
  await page.getByTestId('resize-linked').uncheck()
  await setAxis(page, 'width', 500)
  await setAxis(page, 'height', 500)
  await expect(page.getByTestId('resize-width')).toHaveValue('500')

  const bytes = await download(page)
  expect(await dimensionsOf(page, bytes, 'image/png')).toEqual([500, 500])
})

test('003 respeta el tope de 1920 y el mínimo de 32', async ({ page }) => {
  await open(page)

  // Con proporción, 4000 de ancho pediría 3000 de alto: el par se topea en 1440×1080.
  await setAxis(page, 'width', 4000)
  await expect(page.getByTestId('resize-width')).toHaveValue('1440')
  await expect(page.getByTestId('resize-height')).toHaveValue('1080')

  await page.getByTestId('resize-linked').uncheck()
  await setAxis(page, 'height', 100)
  await setAxis(page, 'width', 4000)
  await expect(page.getByTestId('resize-width')).toHaveValue('1920')

  await setAxis(page, 'width', 10)
  await expect(page.getByTestId('resize-width')).toHaveValue('32')
})

test('003 exporta al formato elegido y puede agrandar', async ({ page }) => {
  await open(page)
  await page.getByTestId('resize-format').selectOption('image/webp')
  await setAxis(page, 'width', 1440)
  await expect(page.getByText(/puede verse borrosa/i)).toBeVisible()

  const bytes = await download(page)
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
  expect(await dimensionsOf(page, bytes, 'image/webp')).toEqual([1440, 1080])
})
