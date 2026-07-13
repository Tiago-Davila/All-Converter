import { useRef } from 'react'
import { readDroppedItems, type IncomingFile } from '../lib/directory-input'

interface DropzoneProps { onFiles(files: IncomingFile[]): void }

const folderInputProps = { webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>

export function Dropzone({ onFiles }: DropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const accept = (files: FileList | null) => onFiles(files ? Array.from(files).map((file) => ({ file, relativePath: file.webkitRelativePath || undefined })) : [])
  return <section aria-label="Agregar archivos" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.items.length) void readDroppedItems(event.dataTransfer.items).then(onFiles); else accept(event.dataTransfer.files) }}>
    <p>Arrastrá archivos o una carpeta, o elegilos desde tu dispositivo.</p>
    <button type="button" onClick={() => fileInputRef.current?.click()}>Elegir archivos</button>
    <button type="button" onClick={() => folderInputRef.current?.click()}>Elegir carpeta</button>
    <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => accept(event.target.files)} />
    <input ref={folderInputRef} type="file" hidden {...folderInputProps} onChange={(event) => accept(event.target.files)} />
  </section>
}
