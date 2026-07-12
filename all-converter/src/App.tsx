import { useState } from 'react'
import type { FileEntry } from './converters/types'
import { detectFileType } from './lib/file-type'
import { Dropzone } from './components/Dropzone'
import { FileQueue } from './components/FileQueue'

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const addFiles = async (files: File[]) => {
    const added = await Promise.all(files.map(async (file): Promise<FileEntry> => ({ id: crypto.randomUUID(), file, name: file.name, sizeBytes: file.size, detectedType: await detectFileType(file), state: file.size === 0 ? 'rejected' : 'ready', rejectionReason: file.size === 0 ? 'El archivo está vacío.' : undefined })))
    setEntries((current) => [...current, ...added])
  }
  return <main><h1>ConvertiTodo</h1><Dropzone onFiles={addFiles} /><FileQueue entries={entries} /></main>
}
