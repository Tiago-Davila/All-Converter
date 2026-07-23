import { useCallback, useRef, useState } from 'react'
import type { FileEntry } from './converters/types'
import { intakeFiles, type IncomingFile } from './lib/directory-input'
import { FileQueue } from './components/FileQueue'
import { NavigationGuard } from './components/NavigationGuard'
import { ShaderBackground } from './ui/background/ShaderBackground'
import { targetFor, type BackgroundActivity } from './ui/background/intensity'
import { Header } from './ui/components/Header'
import { Dropzone } from './ui/components/Dropzone'
import { FormatsShowcase } from './ui/components/FormatsShowcase'
import { IconSprite } from './ui/components/icons'
import { playSound } from './ui/sound/player'

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [batchProgress, setBatchProgress] = useState<number | undefined>(undefined)
  const entriesRef = useRef<FileEntry[]>([])
  // Posición del cursor para el brillo del shader (FR-003), sin re-renders.
  const focusRef = useRef<readonly [number, number]>([0.5, 0.42])

  const addFiles = async (incoming: IncomingFile[]) => {
    if (!incoming.length) return
    const added = await intakeFiles(incoming, entriesRef.current)
    entriesRef.current = [...entriesRef.current, ...added]
    setEntries(entriesRef.current)
    // Sonido por gesto, nunca por archivo (FR-029a/b): si el gesto produjo
    // rechazos suena el de error; si todo entró, el de drop.
    if (added.some((entry) => entry.state === 'rejected')) playSound('reject')
    else if (added.length > 0) playSound('drop')
  }

  const removeEntry = useCallback((id: string) => {
    entriesRef.current = entriesRef.current.filter((entry) => entry.id !== id)
    setEntries(entriesRef.current)
  }, [])

  const clearEntries = useCallback(() => {
    entriesRef.current = []
    setEntries(entriesRef.current)
  }, [])

  const isConverting = batchProgress !== undefined

  const activity: BackgroundActivity = dragOver
    ? 'drag-over'
    : isConverting
    ? 'converting'
    : hovering
    ? 'hover'
    : 'idle'

  const targetIntensity = targetFor(activity, batchProgress)
  const hasFiles = entries.length > 0

  // Cola vacía = "primera página": el shader ocupa todo el viewport y el
  // resto del contenido (header, hero, pie) vive por encima.
  const heroMode = !hasFiles
  const shader = <ShaderBackground targetIntensity={targetIntensity} focusRef={focusRef} />

  return (
    <>
      <IconSprite />
      <div
        className={heroMode ? 'ct-page ct-page-hero' : 'ct-page'}
        onMouseMove={heroMode ? (e) => {
          const r = e.currentTarget.getBoundingClientRect()
          focusRef.current = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]
        } : undefined}
      >
        {heroMode && (
          <div className="ct-page-hero-bg" aria-hidden="true">
            {shader}
            <div className="ct-hero-scrim" />
          </div>
        )}
        <div className="ct-shell">
          <NavigationGuard active={isConverting} />
          <Header />
          <Dropzone
            hasFiles={hasFiles}
            onFiles={(files) => { void addFiles(files) }}
            background={heroMode ? undefined : shader}
            onDragActive={setDragOver}
            onHoverChange={setHovering}
            onPointerMove={heroMode ? undefined : (x, y) => { focusRef.current = [x, y] }}
          />
          <FileQueue
            entries={entries}
            onRemove={removeEntry}
            onClear={clearEntries}
            onBatchActivity={setBatchProgress}
          />
          <p className="ct-footnote">
            Imágenes · Documentos · Video · Audio — todo se convierte en tu
            dispositivo, nada se sube a ningún servidor.
          </p>
        </div>
      </div>
      {/* Catálogo de formatos: showcase de portada, oculto al cargar archivos. */}
      {heroMode && <FormatsShowcase />}
    </>
  )
}
