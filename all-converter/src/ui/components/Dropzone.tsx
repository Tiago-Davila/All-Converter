/**
 * Dropzone (capa UI 002): protagonista cuando la cola está vacía, colapsa a
 * tira fina cuando hay archivos en la cola (T040, FR-010, US3).
 * Delega la lógica de intake en el Dropzone de 001 (src/components/Dropzone.tsx).
 * Este componente es solo la presentación de la capa de experiencia.
 */
import React, { useRef } from 'react'
import { readDroppedItems, type IncomingFile } from '../../lib/directory-input'

export interface DropzoneUIProps {
  /** true = hay archivos en la cola → modo tira fina. */
  hasFiles: boolean
  onFiles(files: IncomingFile[]): void
}

const folderInputProps = { webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>

export function Dropzone({ hasFiles, onFiles }: DropzoneUIProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const accept = (files: FileList | null) =>
    onFiles(
      files
        ? Array.from(files).map((file) => ({
            file,
            relativePath: file.webkitRelativePath || undefined,
          }))
        : []
    )

  return (
    <section
      aria-label="Agregar archivos"
      data-testid="dropzone"
      data-compact={hasFiles ? 'true' : 'false'}
      data-drag-over={dragOver ? 'true' : 'false'}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.items.length) {
          void readDroppedItems(e.dataTransfer.items).then(onFiles)
        } else {
          accept(e.dataTransfer.files)
        }
      }}
      style={hasFiles ? { height: '40px' } : undefined}
    >
      {!hasFiles && (
        <p data-testid="dropzone-prompt">
          Arrastrá archivos o una carpeta, o elegilos desde tu dispositivo.
        </p>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        data-testid="btn-choose-files"
        aria-label={hasFiles ? 'Agregar más archivos' : 'Elegir archivos'}
      >
        {hasFiles ? '+' : 'Elegir archivos'}
      </button>
      {!hasFiles && (
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          data-testid="btn-choose-folder"
        >
          Elegir carpeta
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => accept(e.target.files)}
        data-testid="file-input"
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        {...folderInputProps}
        onChange={(e) => accept(e.target.files)}
        data-testid="folder-input"
      />
    </section>
  )
}
