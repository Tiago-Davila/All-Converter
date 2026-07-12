import type { WorkerRequest } from './types'
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => { if (data.kind === 'cancel') self.close() }
