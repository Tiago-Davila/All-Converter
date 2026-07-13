import { FFmpeg } from '@ffmpeg/ffmpeg'

type Request = { kind: 'start'; jobId: string; input: ArrayBuffer; options: { operation: 'extract-mp3' | 'audio' | 'mp3-mp4'; inputName: string; outputName: string; outputFormat?: string; cover?: ArrayBuffer } } | { kind: 'cancel'; jobId: string }
const send = (message: unknown, transfer?: Transferable[]) => self.postMessage(message, transfer ?? [])
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.kind === 'cancel') { self.close(); return }
  const ffmpeg = new FFmpeg()
  try {
    const multi = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
    send({ kind: 'progress', jobId: data.jobId, progress: { stage: multi ? 'Cargando motor multihilo' : 'Modo compatible, conversión más lenta' } })
    ffmpeg.on('progress', ({ progress }) => send({ kind: 'progress', jobId: data.jobId, progress: { percent: Math.round(progress * 100), stage: 'Convirtiendo' } }))
    await ffmpeg.load({ coreURL: new URL('@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url).toString(), wasmURL: new URL('@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url).toString() })
    await ffmpeg.writeFile(data.options.inputName, new Uint8Array(data.input))
    if (data.options.operation === 'extract-mp3') await ffmpeg.exec(['-i', data.options.inputName, '-vn', '-q:a', '2', data.options.outputName])
    else if (data.options.operation === 'mp3-mp4') { if (!data.options.cover) throw new Error('Se requiere portada o waveform'); await ffmpeg.writeFile('cover.png', new Uint8Array(data.options.cover)); await ffmpeg.exec(['-loop','1','-framerate','30','-i','cover.png','-i',data.options.inputName,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-tune','stillimage','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest',data.options.outputName]) }
    else await ffmpeg.exec(['-i', data.options.inputName, data.options.outputName])
    const output = await ffmpeg.readFile(data.options.outputName) as Uint8Array; send({ kind: 'result', jobId: data.jobId, results: [{ name: data.options.outputName, buffer: output.buffer, sizeBytes: output.byteLength }] }, [output.buffer])
  } catch (error) { send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Falló la conversión multimedia' }) } finally { ffmpeg.terminate() }
}
