/** #107 / T033: prueba cruzada local con el conversor real de la app web. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [entrada, salida] = process.argv.slice(2)
if (!entrada || !salida) throw new Error('Uso: node mcp/scripts/verificar-docx-web.mjs entrada.docx salida.pdf')
if (resolve(entrada) === resolve(salida)) throw new Error('La salida debe ser distinta del documento original.')
const web = fileURLToPath(new URL('../../all-converter/', import.meta.url))
const requireWeb = createRequire(join(web, 'package.json'))
const ejecutable = join(dirname(requireWeb.resolve('vitest/package.json')), 'vitest.mjs')
const carpeta = await mkdtemp(join(web, 'tests', 'mcp-cross-'))
try {
  const prueba = join(carpeta, 'docx-web.test.ts')
  await writeFile(prueba, `
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { docxToPdfConverter } from '../../src/converters/docx-to-pdf'
it('T033: convierte el DOCX del MCP con el conversor de la app web', async () => {
  const bytes = await readFile(${JSON.stringify(resolve(entrada))})
  const archivo = new File([bytes], 'mcp.docx')
  const [pdf] = await docxToPdfConverter.convert(archivo, () => {}, {}, new AbortController().signal)
  expect(pdf.mime).toBe('application/pdf')
  expect(new TextDecoder().decode(pdf.buffer.slice(0, 5))).toBe('%PDF-')
  await writeFile(${JSON.stringify(resolve(salida))}, new Uint8Array(pdf.buffer))
})
`)
  const codigo = await new Promise((res, rej) => {
    const proceso = spawn(process.execPath, [ejecutable, 'run', '--maxWorkers=1', '--fileParallelism=false', relative(web, prueba)], { cwd: web, stdio: 'inherit' })
    proceso.once('error', rej)
    proceso.once('exit', (valor) => res(valor ?? 1))
  })
  if (codigo !== 0) throw new Error('Falló la prueba cruzada DOCX → PDF de la app web.')
} finally {
  // Solo borra el directorio temporal creado por esta ejecución, nunca fixtures existentes.
  await rm(carpeta, { recursive: true, force: true })
}
