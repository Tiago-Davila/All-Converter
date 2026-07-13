import { readFile, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const assetsUrl = new URL('../dist/assets/', import.meta.url)
const entry = (await readdir(assetsUrl)).find((name) => /^index-.*\.js$/.test(name))
if (!entry) throw new Error('No se encontró el entry JavaScript del build.')
const gzipBytes = gzipSync(await readFile(new URL(entry, assetsUrl))).byteLength
const limit = 200 * 1024
if (gzipBytes >= limit) throw new Error(`Entry fuera de presupuesto: ${gzipBytes} bytes gzip (límite ${limit}).`)
console.log(`Bundle verificado: ${gzipBytes} bytes gzip de ${limit} permitidos.`)
