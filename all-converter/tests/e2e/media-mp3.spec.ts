import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const fixture = (name: string) => path.resolve('tests/fixtures', name)

async function uploadAudio(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(fixture('sample.mp3'))
  await expect(page.getByText('sample.mp3', { exact: true })).toBeVisible()
}

async function expectMp4(page: Page) {
  const link = page.getByRole('link', { name: /Descargar .*\.mp4/ })
  await expect(link).toBeVisible()
  const signature = await link.evaluate(async (element: HTMLAnchorElement) => String.fromCharCode(...new Uint8Array(await (await fetch(element.href)).arrayBuffer()).slice(4, 8)))
  expect(signature).toBe('ftyp')
}

test('FIX027 convierte MP3 a MP4 con portada real', async ({ page }) => {
  await uploadAudio(page)
  await page.locator('select.ct-select').first().selectOption('mp3-to-mp4::mp4')
  await page.getByLabel('Usar portada').check()
  await page.getByLabel('Imagen de portada').setInputFiles(fixture('sample.png'))
  await page.getByRole('button', { name: 'Convertir todos' }).click()
  await expectMp4(page)
})

test('FIX027 convierte MP3 a MP4 con waveform generado', async ({ page }) => {
  await uploadAudio(page)
  await page.locator('select.ct-select').first().selectOption('mp3-to-mp4::mp4')
  await page.getByLabel('Generar waveform').check()
  await page.getByRole('button', { name: 'Convertir todos' }).click()
  await expectMp4(page)
})
