import { resolveZipPaths } from '../lib/zip-paths'
import type { WorkerInput } from './types'

export async function executeZip(inputs: readonly WorkerInput[]): Promise<ArrayBuffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const paths = resolveZipPaths(inputs)
  inputs.forEach((input, index) => zip.file(paths[index], new Uint8Array(input.buffer)))
  return zip.generateAsync({ type: 'arraybuffer' })
}
