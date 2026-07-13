import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const mp3Path = path.resolve('tests/fixtures/sample.mp3')

async function convert(page: Page, input: string | { name: string; mimeType: string; buffer: Buffer }, target?: string) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(input)
  await page.getByLabel('Conversión').selectOption('audio-convert')
  if (target) await page.getByLabel('Formato destino').selectOption(target)
  await page.getByRole('button', { name: 'Convertir', exact: true }).click()
  const link = page.getByRole('link', { name: /Descargar/ })
  await expect(link).toBeVisible()
  return Buffer.from(await link.evaluate(async (element: HTMLAnchorElement) => [...new Uint8Array(await (await fetch(element.href)).arrayBuffer())]))
}

const outputs = [
  { extension: 'wav', mime: 'audio/wav', valid: (bytes: Buffer) => bytes.subarray(0, 4).toString() === 'RIFF' },
  { extension: 'ogg', mime: 'audio/ogg', valid: (bytes: Buffer) => bytes.subarray(0, 4).toString() === 'OggS' },
  { extension: 'm4a', mime: 'audio/mp4', valid: (bytes: Buffer) => bytes.subarray(4, 8).toString() === 'ftyp' },
]

for (const output of outputs) {
  test(`FIX028 convierte MP3↔${output.extension.toUpperCase()} con contenedores reales`, async ({ page }) => {
    const encoded = await convert(page, mp3Path, output.extension)
    expect(output.valid(encoded)).toBe(true)
    const mp3 = await convert(page, { name: `audio.${output.extension}`, mimeType: output.mime, buffer: encoded })
    expect(mp3.subarray(0, 3).toString() === 'ID3' || mp3[0] === 0xff).toBe(true)
  })
}
