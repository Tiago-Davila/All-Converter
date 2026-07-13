import { loadFfmpegAssets, preferredFfmpegMode, type FfmpegMode } from '../lib/ffmpeg'

type Request = { kind: 'start'; jobId: string; input: ArrayBuffer; options: { operation: 'extract-mp3' | 'audio' | 'mp3-mp4'; inputName: string; outputName: string; outputFormat?: string; cover?: ArrayBuffer; generateWaveform?: boolean } } | { kind: 'cancel'; jobId: string }
const send = (message: unknown, transfer?: Transferable[]) => self.postMessage(message, { transfer })

function outputMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  return ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
}

async function loadEngine(mode: FfmpegMode) {
  const [{ FFmpeg }, assets] = await Promise.all([import('@ffmpeg/ffmpeg'), loadFfmpegAssets(mode)])
  const ffmpeg = new FFmpeg()
  await ffmpeg.load(assets)
  return ffmpeg
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (data.kind === 'cancel') { self.close(); return }

  let ffmpeg: Awaited<ReturnType<typeof loadEngine>> | undefined
  try {
    let mode = preferredFfmpegMode()
    send({ kind: 'progress', jobId: data.jobId, progress: { stage: mode === 'multithread' ? 'Descargando motor multihilo' : 'Modo compatible, conversión más lenta' } })
    try {
      ffmpeg = await loadEngine(mode)
    } catch (error) {
      if (mode !== 'multithread') throw error
      mode = 'single-thread'
      send({ kind: 'progress', jobId: data.jobId, progress: { stage: 'Modo compatible, conversión más lenta' } })
      ffmpeg = await loadEngine(mode)
    }

    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 0, stage: 'Convirtiendo' } })
    ffmpeg.on('progress', ({ progress }) => send({ kind: 'progress', jobId: data.jobId, progress: { percent: Math.round(progress * 100), stage: 'Convirtiendo' } }))
    await ffmpeg.writeFile(data.options.inputName, new Uint8Array(data.input))
    if (data.options.operation === 'extract-mp3') {
      try {
        await ffmpeg.exec(['-i', data.options.inputName, '-map', '0:a:0', '-vn', '-q:a', '2', data.options.outputName])
      } catch {
        throw new Error('El video no contiene pista de audio.')
      }
    }
    else if (data.options.operation === 'mp3-mp4') {
      if (data.options.cover) await ffmpeg.writeFile('cover.png', new Uint8Array(data.options.cover))
      else if (data.options.generateWaveform) await ffmpeg.exec(['-i', data.options.inputName, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1280x720:colors=0x22c55e', '-frames:v', '1', 'cover.png'])
      else throw new Error('Elegí una portada o generá un waveform para crear el video.')
      await ffmpeg.exec(['-loop', '1', '-framerate', '30', '-i', 'cover.png', '-i', data.options.inputName, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', data.options.outputName])
    } else await ffmpeg.exec(['-i', data.options.inputName, data.options.outputName])
    const output = await ffmpeg.readFile(data.options.outputName) as Uint8Array
    send({ kind: 'result', jobId: data.jobId, results: [{ name: data.options.outputName, mime: outputMime(data.options.outputName), buffer: output.buffer, sizeBytes: output.byteLength }] }, [output.buffer])
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Falló la conversión multimedia' })
  } finally {
    ffmpeg?.terminate()
  }
}
