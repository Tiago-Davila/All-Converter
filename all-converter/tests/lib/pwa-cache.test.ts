import { describe, expect, it } from 'vitest'
import { conversionAssetCacheName, heavyConversionAssetPattern, heavyPrecacheIgnores } from '../../src/lib/pwa-cache'

describe('cache PWA de conversores pesados', () => {
  it.each([
    '/assets/ffmpeg-core-hash.wasm',
    '/assets/ffmpeg-core-hash.js',
    '/assets/media.worker-hash.js',
    '/assets/pdf.worker.min-hash.mjs',
  ])('cachea %s solo bajo demanda', (path) => {
    expect(heavyConversionAssetPattern.test(path)).toBe(true)
  })

  it('no confunde el shell inicial con un asset pesado', () => {
    expect(heavyConversionAssetPattern.test('/assets/index-hash.js')).toBe(false)
    expect(heavyConversionAssetPattern.test('/assets/index-hash.css')).toBe(false)
  })

  it('excluye WASM, workers y cores del precache inicial', () => {
    expect(heavyPrecacheIgnores).toEqual(expect.arrayContaining(['**/*.wasm', '**/*.worker*.js', '**/ffmpeg-core-*.js']))
    expect(conversionAssetCacheName).toBe('conversion-assets-v1')
  })
})
