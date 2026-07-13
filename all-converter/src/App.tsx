import { useRef, useState } from 'react'
import type { FileEntry } from './converters/types'
import { intakeFiles, type IncomingFile } from './lib/directory-input'
import { Dropzone } from './components/Dropzone'
import { FileQueue } from './components/FileQueue'
import { PrivacyNotice } from './components/PrivacyNotice'
import { NavigationGuard } from './components/NavigationGuard'
import { ShaderBackground } from './ui/background/ShaderBackground'
import { targetFor, type BackgroundActivity } from './ui/background/intensity'

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [hovering, setHovering] = useState(false)
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

  // Progreso global 0–1 (promedio de los archivos en converting)
  // La FileQueue de 001 no expone el progreso individual al padre todavía;
  // usamos 0.5 como estimación hasta que T042 migre la cola a la capa UI.
  const progress = isConverting ? 0.5 : undefined
  const targetIntensity = targetFor(activity, progress)

  return (
    <>
      {/* Fondo animado: decorativo, pointer-events none, no bloquea la UI (invariante 1) */}
      <ShaderBackground targetIntensity={targetIntensity} focusValue={dragOver ? 1 : 0} />
      <main
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        onDrop={() => setDragOver(false)}
      >
        <NavigationGuard active={isConverting} />
        <h1>ConvertiTodo</h1>
        <PrivacyNotice />
        <Dropzone onFiles={(files) => { void addFiles(files) }} />
        <FileQueue entries={entries} />
      </main>
    </>
  )
}
