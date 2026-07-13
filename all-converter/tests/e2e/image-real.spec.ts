import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const fixture = (name: string) => path.resolve('tests/fixtures', name)

async function convert(page: Page, input: string | { name: string; mimeType: string; buffer: Buffer }, target: string, maxWidth?: number) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(input)
  await page.getByLabel('Formato destino').selectOption(target)
  if (maxWidth) await page.getByLabel('Ancho máximo').fill(String(maxWidth))
  await page.getByRole('button', { name: 'Convertir', exact: true }).click()
  const link = page.getByRole('link', { name: new RegExp(`Descargar .*\\.${target}`) })
  await expect(link).toBeVisible()
  return Buffer.from(await link.evaluate(async (element: HTMLAnchorElement) => [...new Uint8Array(await (await fetch(element.href)).arrayBuffer())]))
}

test('FIX029 produce JPG dimensionado y WebP reales', async ({ page }) => {
  const jpg = await convert(page, fixture('sample.png'), 'jpg', 100)
  expect(jpg[0]).toBe(0xff)
  const dimensions = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
    const value = [bitmap.width, bitmap.height]
    bitmap.close()
    return value
  }, [...jpg])
  expect(dimensions).toEqual([100, 75])

  const webp = await convert(page, fixture('sample.png'), 'webp')
  expect(webp.subarray(0, 4).toString()).toBe('RIFF')
  expect(webp.subarray(8, 12).toString()).toBe('WEBP')
  const png = await convert(page, { name: 'real.webp', mimeType: 'image/webp', buffer: webp }, 'png')
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
})

test('FIX029 aplana transparencia sobre blanco al convertir a JPG', async ({ page }) => {
  await page.goto('/')
  const transparent = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
    const context = canvas.getContext('2d')!; context.clearRect(0, 0, 2, 2); context.fillStyle = 'rgba(255,0,0,.5)'; context.fillRect(0, 0, 1, 1)
    return [...new Uint8Array(await (await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))).arrayBuffer())]
  }))
  const jpg = await convert(page, { name: 'transparent.png', mimeType: 'image/png', buffer: transparent }, 'jpg')
  const alpha = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
    const canvas = new OffscreenCanvas(2, 2); const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    return context.getImageData(0, 0, 2, 2).data[3]
  }, [...jpg])
  expect(alpha).toBe(255)
})

test('FIX029 rechaza WebP animado real', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(fixture('animated.webp'))
  await page.getByRole('button', { name: 'Convertir', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('animadas no se pueden convertir')
})
