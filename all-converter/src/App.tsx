import { useRef, useState } from 'react'
import type { FileEntry } from './converters/types'
import { intakeFiles, type IncomingFile } from './lib/directory-input'
import { FileQueue } from './components/FileQueue'
import { NavigationGuard } from './components/NavigationGuard'
import { ShaderBackground } from './ui/background/ShaderBackground'
import { targetFor, type BackgroundActivity } from './ui/background/intensity'
import { Header } from './ui/components/Header'
import { Dropzone } from './ui/components/Dropzone'
import { ZipBar } from './ui/components/ZipBar'

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [zipUrl, setZipUrl] = useState<string | null>(null)
  const entriesRef = useRef<FileEntry[]>([])

  const addFiles = async (incoming: IncomingFile[]) => {
    const added = await intakeFiles(incoming, entriesRef.current)
    entriesRef.current = [...entriesRef.current, ...added]
    setEntries(entriesRef.current)
  }

  // Actividad y progreso para el fondo animado
  const convertingEntries = entries.filter((e) => e.state === 'converting')
  const isConverting = convertingEntries.length > 0

  const activity: BackgroundActivity = dragOver
    ? 'drag-over'
    : hovering
    ? 'hover'
    : isConverting
    ? 'converting'
    : 'idle'

  const progress = isConverting ? 0.5 : undefined
  const targetIntensity = targetFor(activity, progress)

  const completedCount = entries.filter((e) => e.state === 'completed').length
  const hasFiles = entries.length > 0

  return (
    <>
      {/* Fondo animado: decorativo, pointer-events none, no bloquea la UI (invariante 1) */}
      <ShaderBackground targetIntensity={targetIntensity} focusValue={dragOver ? 1 : 0} />
      <Header />
      <main
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        onDrop={() => setDragOver(false)}
      >
        <NavigationGuard active={isConverting} />
        <Dropzone hasFiles={hasFiles} onFiles={(files) => { void addFiles(files) }} />
        <FileQueue entries={entries} />
        <ZipBar zipUrl={zipUrl} completedCount={completedCount} />
      </main>
    </>
  )
}
