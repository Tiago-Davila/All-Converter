import { expect, test } from '@playwright/test'
import path from 'node:path'

const fixture = (name: string) => path.resolve('tests/fixtures', name)

async function upload(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(fixture(name))
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

test('FIX026 convierte MP4 con audio a un MP3 real', async ({ page }) => {
  await upload(page, 'sample.mp4')
  await page.getByRole('button', { name: 'Convertir', exact: true }).click()
  const link = page.getByRole('link', { name: /Descargar .*\.mp3/ })
  await expect(link).toBeVisible()
  const bytes = await link.evaluate(async (element: HTMLAnchorElement) => [...new Uint8Array(await (await fetch(element.href)).arrayBuffer()).slice(0, 4)])
  expect(bytes.length).toBe(4)
  expect(bytes.some((byte) => byte !== 0)).toBe(true)
})

test('FIX026 rechaza MP4 sin pista de audio', async ({ page }) => {
  await upload(page, 'silent.mp4')
  await page.getByRole('button', { name: 'Convertir', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('no contiene pista de audio')
})
