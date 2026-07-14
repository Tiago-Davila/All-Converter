export function isAnimatedRaster(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('acTL') || text.includes('ANIM')
}
