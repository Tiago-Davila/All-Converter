/**
 * Dropzone (capa UI 002): hero oscuro con el shader de fondo (mockup DEP-001).
 * Protagonista cuando la cola está vacía; colapsa a tira fina con archivos
 * (T040, FR-009, US3). Delega la lectura de archivos en lib/directory-input.
 *
 * El fondo animado llega como nodo (prop background) para que App controle la
 * intensidad; este componente reporta drag/hover/cursor hacia arriba.
 */
import React, { useRef } from 'react'
import { readDroppedItems, type IncomingFile } from '../../lib/directory-input'
import { Icon } from './icons'

export interface DropzoneUIProps {
  /** true = hay archivos en la cola → modo tira fina. */
  hasFiles: boolean
  /** `skipped` = archivos que el recorrido no exploró por el techo de MAX_SCAN_FILES. */
  onFiles(files: IncomingFile[], skipped?: number): void
  /** Fondo animado (ShaderBackground) inyectado por App. */
  background?: React.ReactNode
  /** Reporta si hay un drag activo sobre la zona (para la intensidad del shader). */
  onDragActive?(active: boolean): void
  /** Reporta hover del puntero sobre la zona. */
  onHoverChange?(hovering: boolean): void
  /** Posición del cursor en UV [0,1] (origen abajo-izquierda) para el brillo del shader. */
  onPointerMove?(x: number, y: number): void
}

const folderInputProps = { webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>

export function Dropzone({
  hasFiles,
  onFiles,
  background,
  onDragActive,
  onHoverChange,
  onPointerMove,
}: DropzoneUIProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const setDrag = (value: boolean) => {
    setDragOver(value)
    onDragActive?.(value)
  }

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
      className="ct-hero"
      data-testid="dropzone"
      data-compact={hasFiles ? 'true' : 'false'}
      data-drag-over={dragOver ? 'true' : 'false'}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        if (e.dataTransfer.items.length) {
          void readDroppedItems(e.dataTransfer.items).then(({ files, skipped }) => onFiles(files, skipped))
        } else {
          accept(e.dataTransfer.files)
        }
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onMouseMove={(e) => {
        if (!onPointerMove) return
        const r = e.currentTarget.getBoundingClientRect()
        onPointerMove((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
      }}
    >
      {background}
      {background && <div className="ct-hero-scrim" aria-hidden="true" />}

      {/* Líneas del dropzone: visibles en reposo; se desvanecen al arrastrar
          (el velo animado toma el relevo con su propio anillo + blur). */}
      <span className="ct-hero-frame" aria-hidden="true" />

      {!hasFiles && (
        <div className="ct-hero-body">
          <span className="ct-hero-glyph" aria-hidden="true">
            <Icon name="upload" size={26} />
          </span>
          <h1 className="ct-hero-title" data-testid="dropzone-prompt">
            Tus archivos nunca salen del navegador
          </h1>
          <p className="ct-hero-lead">
            Convertí imágenes, documentos, video y audio localmente. Sin subidas,
            sin servidores, sin esperas. Arrastrá archivos o una carpeta, o
            elegilos desde tu dispositivo.
          </p>
          <div className="ct-hero-actions">
            <button
              type="button"
              className="ct-btn ct-btn-hero-primary"
              onClick={() => fileInputRef.current?.click()}
              data-testid="btn-choose-files"
              aria-label="Elegir archivos"
            >
              <Icon name="folder" size={16} />
              Elegir archivos
            </button>
            <button
              type="button"
              className="ct-btn ct-btn-hero-ghost"
              onClick={() => folderInputRef.current?.click()}
              data-testid="btn-choose-folder"
            >
              Elegir carpeta
            </button>
            {/* Herramienta aparte, no es un destino de la cola (003 FR-015). */}
            <a
              className="ct-btn ct-btn-hero-ghost"
              href="#/redimensionar"
              data-testid="btn-resize"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="img" size={16} />
              Redimensionar imagen
            </a>
          </div>
          <span className="ct-hero-badge">
            <Icon name="shield" size={14} className="ct-icn-shield-hero" />
            100% local — el procesamiento ocurre en tu dispositivo
          </span>
        </div>
      )}

      {hasFiles && (
        <div className="ct-hero-strip">
          <div className="ct-hero-strip-info">
            <span className="ct-hero-strip-glyph" aria-hidden="true">
              <Icon name="upload" size={19} />
            </span>
            <span className="ct-hero-strip-text">
              <span className="ct-hero-strip-title">Arrastrá más o hacé clic para agregar</span>
              <span className="ct-hero-strip-sub">todo se procesa localmente</span>
            </span>
          </div>
          <button
            type="button"
            className="ct-btn ct-btn-hero-primary ct-btn-sm"
            onClick={() => fileInputRef.current?.click()}
            data-testid="btn-choose-files"
            aria-label="Agregar más archivos"
          >
            <Icon name="folder" size={15} />
            Agregar
          </button>
        </div>
      )}

      {dragOver && (
        <div className="ct-hero-dragveil" aria-hidden="true">
          <span className="ct-hero-dragring" />
          <span className="ct-hero-dragglyph">
            <Icon name="download" size={26} />
          </span>
          <span className="ct-hero-dragtext">Soltá acá para empezar</span>
        </div>
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
