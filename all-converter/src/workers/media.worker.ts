import { downloadFfmpegAssets, preferredFfmpegMode, type FfmpegMode } from '../lib/ffmpeg'
import type { WorkerRequest, WorkerResponse } from './types'
import { resultTransferables } from './worker-utils'
import { validateMediaRequest } from './validation'

const send = (message: WorkerResponse, transfer?: Transferable[]) => self.postMessage(message, { transfer })

function outputMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  return ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
}

async function loadEngine(mode: FfmpegMode, onDownload: (percent: number) => void) {
  const [{ FFmpeg }, downloaded] = await Promise.all([import('@ffmpeg/ffmpeg'), downloadFfmpegAssets(mode, onDownload)])
  const ffmpeg = new FFmpeg()
  try { await ffmpeg.load(downloaded.assets); return { ffmpeg, revoke: downloaded.revoke } } catch (error) { downloaded.revoke(); throw error }
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.kind === 'cancel') { self.close(); return }

  let engine: Awaited<ReturnType<typeof loadEngine>> | undefined
  try {
    validateMediaRequest(data)
    const input = data.inputs[0]
    if (!input) throw new Error('La conversión multimedia requiere un archivo de entrada.')
    const outputName = data.options.outputName
    if (typeof outputName !== 'string') throw new Error('Falta el nombre del archivo de salida.')
    let mode: FfmpegMode = data.operation === 'mp3-mp4' ? 'single-thread' : preferredFfmpegMode()
    send({ kind: 'progress', jobId: data.jobId, progress: { stage: mode === 'multithread' ? 'Descargando motor multihilo' : 'Modo compatible, conversión más lenta' } })
    try {
      engine = await loadEngine(mode, (percent) => send({ kind: 'progress', jobId: data.jobId, progress: { percent, stage: 'Descargando motor' } }))
    } catch (error) {
      if (mode !== 'multithread') throw error
      mode = 'single-thread'
      send({ kind: 'progress', jobId: data.jobId, progress: { stage: 'Modo compatible, conversión más lenta' } })
      engine = await loadEngine(mode, (percent) => send({ kind: 'progress', jobId: data.jobId, progress: { percent, stage: 'Descargando motor compatible' } }))
    }

    const ffmpeg = engine.ffmpeg
    send({ kind: 'progress', jobId: data.jobId, progress: { percent: 0, stage: 'Convirtiendo' } })
    ffmpeg.on('progress', ({ progress }) => send({ kind: 'progress', jobId: data.jobId, progress: { percent: Math.round(progress * 100), stage: 'Convirtiendo' } }))
    await ffmpeg.writeFile(input.name, new Uint8Array(input.buffer))
    if (data.operation === 'extract-mp3') {
      const exitCode = await ffmpeg.exec(['-i', input.name, '-map', '0:a:0', '-vn', '-q:a', '2', outputName])
      if (exitCode !== 0) throw new Error('El video no contiene pista de audio.')
    }
    else if (data.operation === 'mp3-mp4') {
      let durationSeconds = 0
      const readDuration = ({ message }: { message: string }) => {
        const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(message)
        if (match) durationSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      }
      ffmpeg.on('log', readDuration)
      try { await ffmpeg.exec(['-i', input.name]) } finally { ffmpeg.off('log', readDuration) }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('No se pudo determinar la duración del audio.')
      const cover = data.inputs[1]
      const coverName = cover?.name ?? 'cover.png'
      if (cover) await ffmpeg.writeFile(coverName, new Uint8Array(cover.buffer))
      else if (data.options.generateWaveform === true) await ffmpeg.exec(['-i', input.name, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=0x22c55e', '-frames:v', '1', coverName])
      else throw new Error('Elegí una portada o generá un waveform para crear el video.')
      const exitCode = await ffmpeg.exec(['-i', input.name, '-loop', '1', '-framerate', '1', '-i', coverName, '-map', '1:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-r', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(durationSeconds), outputName])
      if (exitCode !== 0) throw new Error('No se pudo crear el video con la portada seleccionada.')
    } else await ffmpeg.exec(['-i', input.name, outputName])
    const output = await ffmpeg.readFile(outputName) as Uint8Array
    const results = [{ name: outputName, mime: outputMime(outputName), buffer: output.buffer as ArrayBuffer, sizeBytes: output.byteLength }]
    send({ kind: 'result', jobId: data.jobId, results }, resultTransferables(results))
  } catch (error) {
    send({ kind: 'error', jobId: data.jobId, message: error instanceof Error ? error.message : 'Falló la conversión multimedia' })
  } finally {
    engine?.ffmpeg.terminate()
    engine?.revoke()
  }
}
