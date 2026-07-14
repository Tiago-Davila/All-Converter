/**
 * T043 — Test de cero red en runtime.
 * Verificación estática de que ningún asset (fuente, audio, shader) se carga
 * desde un origen remoto y que no hay telemetría en el código fuente
 * (Principios II y XVI, FR-045, SC-010).
 *
 * Este test es un análisis de código fuente, no un test de navegador.
 * Se ejecuta en Node y es determinista.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '')
const SRC_DIR = join(ROOT, 'src')

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lee todos los archivos de src/ con las extensiones dadas, recursivamente. */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, exts))
    } else if (exts.includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

// ── Patrones de red prohibidos ───────────────────────────────────────────────

const REMOTE_URL_PATTERNS = [
  /https?:\/\/cdn\./i,
  /https?:\/\/unpkg\.com/i,
  /https?:\/\/jsdelivr\.net/i,
  /https?:\/\/cdnjs\.cloudflare\.com/i,
  /https?:\/\/fonts\.googleapis\.com/i,
  /https?:\/\/fonts\.gstatic\.com/i,
  /https?:\/\/ajax\.googleapis\.com/i,
  /https?:\/\/maxcdn\./i,
  /https?:\/\/stackpath\./i,
]

// Patrones de telemetría/analytics prohibidos
const TELEMETRY_PATTERNS = [
  /google-analytics/i,
  /googletagmanager/i,
  /gtag\(/,
  /ga\(\s*['"]send/,
  /mixpanel/i,
  /segment\.com/i,
  /amplitude\.com/i,
  /hotjar/i,
  /sentry\.io/i,          // Sentry es OK como dependencia, no como telemetría remota en runtime
  /datadog/i,
  /newrelic/i,
  /plausible\.io/i,
  /matomo/i,
  /heap\.io/i,
]

// ── Tests ─────────────────────────────────────────────────────────────────────

const tsFiles  = collectFiles(SRC_DIR, ['.ts', '.tsx'])
const cssFiles = collectFiles(SRC_DIR, ['.css'])
const allSrc   = readAll(tsFiles)
const allCss   = readAll(cssFiles)

describe('Cero red en runtime (T043)', () => {
  describe('Sin imports remotos en archivos TypeScript/TSX', () => {
    for (const pattern of REMOTE_URL_PATTERNS) {
      it(`no contiene "${pattern.source}"`, () => {
        // Excluimos comentarios de una sola línea para evitar falsos positivos en docs
        const withoutLineComments = allSrc.replace(/\/\/.*$/gm, '')
        expect(withoutLineComments).not.toMatch(pattern)
      })
    }
  })

  describe('Sin @import remoto en CSS', () => {
    it('no usa @import con URL externa', () => {
      // @import url(https://...) está prohibido (COEP también lo bloquearía)
      expect(allCss).not.toMatch(/@import\s+url\s*\(\s*['"]?https?:/i)
    })

    it('no usa url() externo para fuentes o imágenes', () => {
      // url(https://...) en CSS es una petición de red
      expect(allCss).not.toMatch(/url\s*\(\s*['"]?https?:/i)
    })
  })

  describe('Sin telemetría ni analytics', () => {
    for (const pattern of TELEMETRY_PATTERNS) {
      it(`no contiene "${pattern.source}"`, () => {
        const withoutLineComments = allSrc.replace(/\/\/.*$/gm, '')
        expect(withoutLineComments).not.toMatch(pattern)
      })
    }
  })

  describe('Shader inline (no carga desde URL)', () => {
    it('shader.glsl.ts exporta strings literales, no URLs', () => {
      const shaderFile = join(SRC_DIR, 'ui/background/shader.glsl.ts')
      const content = readFileSync(shaderFile, 'utf8')
      // No debe haber fetch() ni import() de una URL remota
      expect(content).not.toMatch(/fetch\s*\(\s*['"]https?:/)
      expect(content).not.toMatch(/import\s*\(\s*['"]https?:/)
      // Debe exportar constantes de string
      expect(content).toMatch(/export\s+const\s+VERTEX_SHADER/)
      expect(content).toMatch(/export\s+const\s+FRAGMENT_SHADER/)
    })
  })

  describe('Fuentes self-hosteadas', () => {
    it('no hay petición a Google Fonts en CSS', () => {
      expect(allCss).not.toMatch(/fonts\.googleapis\.com/)
      expect(allCss).not.toMatch(/fonts\.gstatic\.com/)
    })
  })
})
