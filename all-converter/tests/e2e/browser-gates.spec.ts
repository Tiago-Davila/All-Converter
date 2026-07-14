import { expect, test } from '@playwright/test'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'

const sample = path.resolve('tests/fixtures/sample.png')

async function convertImage(page: import('@playwright/test').Page) {
  await page.locator('input[type=file]').first().setInputFiles(sample)
  await page.locator('select.ct-select').first().selectOption('image-convert::jpg')
  await page.getByRole('button', { name: 'Convertir todos' }).click()
  await expect(page.getByRole('link', { name: /Descargar .*\.jpg/ })).toBeVisible()
}

test('FIX030 ejecuta workers aislados sin red externa', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.ready.then(() => true))).toBe(true)
  await convertImage(page)
  expect(await page.evaluate(() => ({ isolated: crossOriginIsolated, sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', workers: typeof Worker !== 'undefined' }))).toEqual({ isolated: true, sharedArrayBuffer: true, workers: true })
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173')).toBe(true)
})

test('FIX030 convierte offline después del primer uso', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.update()))
  await convertImage(page)
  await context.setOffline(true)
  await page.reload()
  await convertImage(page)
  await context.setOffline(false)
})

test('FIX030 mantiene el entry inicial debajo de 200 KB gzip', async () => {
  const assets = await readdir(path.resolve('dist/assets'))
  const entry = assets.find((name) => /^index-.*\.js$/.test(name))
  expect(entry).toBeTruthy()
  const compressed = gzipSync(await readFile(path.resolve('dist/assets', entry!)))
  expect(compressed.byteLength).toBeLessThan(200 * 1024)
})
