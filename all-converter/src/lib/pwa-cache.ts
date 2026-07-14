export const heavyConversionAssetPattern = /\/assets\/(?:.*\.wasm|.*\.worker[^/]*\.(?:js|mjs)|ffmpeg-core-[^/]*\.js)$/

export const heavyPrecacheIgnores = [
  '**/*.wasm',
  '**/*.worker*.js',
  '**/*.worker*.mjs',
  '**/ffmpeg-core-*.js',
]

export const conversionAssetCacheName = 'conversion-assets-v1'
