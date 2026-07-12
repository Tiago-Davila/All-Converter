import { useRef } from 'react'

interface DropzoneProps { onFiles(files: File[]): void }
export function Dropzone({ onFiles }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const accept = (files: FileList | null) => onFiles(files ? Array.from(files) : [])
  return <section aria-label="Agregar archivos" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); accept(event.dataTransfer.files) }}>
    <p>Arrastrá archivos aquí o elegilos desde tu dispositivo.</p>
    <button type="button" onClick={() => inputRef.current?.click()}>Elegir archivos</button>
    <input ref={inputRef} type="file" multiple hidden onChange={(event) => accept(event.target.files)} />
  </section>
}
