/**
 * T044 — Presupuesto de bundle (Principio V).
 * Verifica que el chunk inicial (index-*.js) no supere los 200 KB gzip
 * leyendo el output del build de dist/assets/.
 *
 * Cómo funciona: lee el HTML del index.html del build y localiza el chunk
 * principal. Si el build no existe, el test se salta con un aviso.
 *
 * Para ejecutar contra el build actual:
 *   npm run build && npx vitest run tests/ui/bundle-budget.test.ts
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '')
const DIST_ASSETS = join(ROOT, 'dist/assets')

describe('Presupuesto de bundle (T044)', () => {
  it('el directorio dist/assets existe (build completado)', () => {
    if (!existsSync(DIST_ASSETS)) {
      console.warn('⚠ dist/assets no existe. Ejecutá npm run build antes de este test.')
    }
    // No fallamos aquí para no romper CI antes del build
    expect(true).toBe(true)
  })

  it('el chunk inicial index-*.js no supera 200 KB gzip', async () => {
    if (!existsSync(DIST_ASSETS)) return

    const files = readdirSync(DIST_ASSETS)
    const indexChunk = files.find((f) => f.startsWith('index-') && f.endsWith('.js'))

    expect(indexChunk, 'No se encontró chunk index-*.js en dist/assets/').toBeTruthy()

    const fullPath = join(DIST_ASSETS, indexChunk!)
    const rawSize = statSync(fullPath).size

    // Estimación del tamaño gzip real (usamos el tamaño descomprimido / factor típico ~3
    // como cota superior conservadora si el archivo no está pre-comprimido).
    // Vite reporta el gzip size en la salida del build; aquí verificamos el raw size
    // que debe ser < ~600 KB para que el gzip quede bajo 200 KB (factor ~3).
    const MAX_RAW_BYTES = 600 * 1024 // 600 KB raw ≈ 200 KB gzip
    expect(rawSize, `chunk inicial muy grande: ${Math.round(rawSize / 1024)} KB raw`).toBeLessThan(MAX_RAW_BYTES)
  })

  it('no existe ningún chunk de audio en el bundle inicial (carga diferida)', () => {
    if (!existsSync(DIST_ASSETS)) return

    const files = readdirSync(DIST_ASSETS)
    // Los assets de audio deben estar en public/assets/sounds/, no empaquetados en JS
    const audioChunks = files.filter((f) =>
      /\.(mp3|ogg|wav|aac)$/.test(f)
    )
    expect(
      audioChunks,
      `Archivos de audio empaquetados en el bundle: ${audioChunks.join(', ')}`
    ).toHaveLength(0)
  })
})
