import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../../src/ui/a11y/contrast'
import { MIN_CONTRAST, SURFACE, TOKENS } from '../../../src/ui/a11y/tokens'

const SRC_ROOT = join(__dirname, '..', '..', '..', 'src')

function collectCssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectCssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

/** Descarta comentarios /* ... * / para no matchear texto explicativo, solo reglas reales. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('foco visible global', () => {
  const cssFiles = collectCssFiles(SRC_ROOT)
  const cssSources = cssFiles.map((file) => ({ file, text: readFileSync(file, 'utf-8') }))

  it('define una regla :focus-visible global', () => {
    expect(cssSources.some(({ text }) => /:focus-visible\s*{/.test(text))).toBe(true)
  })

  it('el anillo de foco usa el token focus-ring, no un color inventado', () => {
    const rule = cssSources.find(({ text }) => /:focus-visible\s*{/.test(text))
    expect(rule?.text).toMatch(/:focus-visible\s*{[^}]*var\(--ct-focus-ring\)/)
  })

  it('focus-ring cumple el umbral 3:1 contra la superficie (Principio XII)', () => {
    expect(contrastRatio(TOKENS['focus-ring'], SURFACE)).toBeGreaterThanOrEqual(MIN_CONTRAST.ui)
  })

  it('ningún CSS quita el foco sin reemplazarlo (nada de outline: none/0 suelto)', () => {
    const offenders = cssSources.filter(({ text }) => /outline\s*:\s*(none|0)\b/i.test(stripComments(text)))
    expect(offenders.map((o) => o.file)).toEqual([])
  })
})
