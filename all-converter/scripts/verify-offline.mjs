import { readdir, readFile } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
const sw = await readFile(new URL('sw.js', dist), 'utf8')
const assets = await readdir(new URL('assets/', dist))
const precache = sw.match(/precacheAndRoute\((\[.*?\]),\{\}\)/)?.[1]

if (!precache) throw new Error('No se encontró el manifiesto de precache en dist/sw.js.')
for (const fragment of ['.wasm', '.worker-', '.worker.', 'ffmpeg-core-']) {
  if (precache.includes(fragment)) throw new Error(`El precache inicial contiene un asset pesado: ${fragment}`)
}

const ffmpegCores = assets.filter((name) => name.startsWith('ffmpeg-core-') && name.endsWith('.wasm'))
if (ffmpegCores.length !== 2) throw new Error(`Se esperaban dos cores ffmpeg emitidos, se encontraron ${ffmpegCores.length}.`)
if (!sw.includes('conversion-assets-v1') || !sw.includes('CacheFirst')) {
  throw new Error('El service worker no conserva assets de conversión después del primer uso.')
}

const index = await readFile(new URL('index.html', dist), 'utf8')
for (const core of ffmpegCores) {
  if (index.includes(core)) throw new Error(`El shell inicial descarga el core ${core}.`)
}

console.log(`Offline verificado: precache liviano, ${ffmpegCores.length} cores disponibles solo bajo demanda y cache runtime activo.`)
