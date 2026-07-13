export function supportsMultithreadFfmpeg(): boolean { return globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined' }
export async function loadFfmpeg() { const module = await import('@ffmpeg/ffmpeg'); return { FFMPEG: module.FFmpeg, mode: supportsMultithreadFfmpeg() ? 'multithread' : 'single-thread' as const } }
