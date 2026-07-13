import { useRef, useState } from 'react'
import type { FileEntry } from './converters/types'
import { intakeFiles, type IncomingFile } from './lib/directory-input'
import { Dropzone } from './components/Dropzone'
import { FileQueue } from './components/FileQueue'
import { PrivacyNotice } from './components/PrivacyNotice'
import { NavigationGuard } from './components/NavigationGuard'

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const entriesRef = useRef<FileEntry[]>([])
  const addFiles = async (incoming: IncomingFile[]) => {
    const added = await intakeFiles(incoming, entriesRef.current)
    entriesRef.current = [...entriesRef.current, ...added]
    setEntries(entriesRef.current)
  }
  return <main><NavigationGuard active={entries.some((entry) => entry.state === 'converting')} /><h1>ConvertiTodo</h1><PrivacyNotice /><Dropzone onFiles={(files) => { void addFiles(files) }} /><FileQueue entries={entries} /></main>
}
