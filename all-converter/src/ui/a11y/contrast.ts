/** Cálculo de contraste WCAG 2.1 por luminancia relativa (research.md §D1). */

function channelLuminance(value255: number): number {
  const c = value255 / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return [r, g, b]
}

/** Luminancia relativa de un color hex (0..1). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** Ratio de contraste WCAG entre dos colores hex (siempre >= 1). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** true si el par cumple el umbral AA dado (4.5 texto normal, 3.0 componentes/texto grande). */
export function meetsAA(foreground: string, background: string, minRatio: number): boolean {
  return contrastRatio(foreground, background) >= minRatio
}
