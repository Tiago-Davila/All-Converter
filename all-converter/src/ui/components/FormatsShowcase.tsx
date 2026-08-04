/**
 * FormatsShowcase (capa UI): grilla informativa de todo lo que la app convierte.
 * Aparece solo en la portada (cola vacía) como banda clara bajo el hero oscuro.
 *
 * Catálogo estático: el registro (converters/registry.ts) no expone
 * descripción/ícono/acento por conversor, así que la copia curada vive acá.
 * Mantener 1:1 con los conversores registrados.
 */
import React from 'react'
import { Icon, type IconName } from './icons'

type FormatCategory = 'pdf' | 'image' | 'doc' | 'sheet' | 'audio' | 'video'

interface FormatCard {
  title: string
  desc: string
  cat: FormatCategory
}

const CATEGORY_ICON: Record<FormatCategory, IconName> = {
  pdf: 'doc',
  image: 'img',
  doc: 'doc',
  sheet: 'doc',
  audio: 'audio',
  video: 'video',
}

const FORMATS: readonly FormatCard[] = [
  { title: 'Unir PDFs', desc: 'Combiná varios PDF en uno solo.', cat: 'pdf' },
  { title: 'Dividir PDF', desc: 'Separá un PDF en varios archivos.', cat: 'pdf' },
  { title: 'Rotar PDF', desc: 'Girá las páginas de tu PDF.', cat: 'pdf' },
  { title: 'PDF a Word', desc: 'Convertí PDF a DOCX editable.', cat: 'doc' },
  { title: 'PDF a Markdown', desc: 'Pasá un PDF con estructura a .md.', cat: 'doc' },
  { title: 'PDF a imágenes', desc: 'Extraé cada página como PNG o JPG.', cat: 'image' },
  { title: 'PDF a TXT', desc: 'Extraé el texto plano de tu PDF.', cat: 'pdf' },
  { title: 'Word a PDF', desc: 'Convertí documentos DOCX a PDF.', cat: 'doc' },
  { title: 'Word a Excel', desc: 'Pasá las tablas de un DOCX a XLSX.', cat: 'sheet' },
  { title: 'Word a texto/HTML', desc: 'Extraé el contenido en TXT o HTML.', cat: 'doc' },
  { title: 'Markdown a PDF', desc: 'Convertí un .md en un PDF paginado.', cat: 'doc' },
  { title: 'Convertir imagen', desc: 'Entre PNG, JPG y WebP.', cat: 'image' },
  { title: 'Imágenes a PDF', desc: 'Uní varias imágenes en un PDF.', cat: 'pdf' },
  { title: 'Convertir planilla', desc: 'Entre CSV, JSON y XLSX.', cat: 'sheet' },
  { title: 'Planilla a PDF', desc: 'Convertí tu planilla a PDF.', cat: 'pdf' },
  { title: 'MP4 a MP3', desc: 'Extraé el audio de un video.', cat: 'audio' },
  { title: 'MP3 a MP4', desc: 'Creá un video con carátula desde audio.', cat: 'video' },
  { title: 'Convertir audio', desc: 'Entre MP3, WAV, OGG y M4A.', cat: 'audio' },
]

export function FormatsShowcase(): React.ReactElement {
  return (
    <section className="ct-formats" aria-labelledby="ct-formats-title">
      <div className="ct-formats-inner">
        <p className="ct-formats-eyebrow">Formatos</p>
        <h2 className="ct-formats-title" id="ct-formats-title">
          Todo lo que podés convertir
        </h2>
        <p className="ct-formats-lead">
          Imágenes, documentos, planillas, PDF, audio y video — siempre en tu
          dispositivo.
        </p>
        <div className="ct-formats-grid">
          {FORMATS.map((format) => (
            <article className="ct-format-card" key={format.title}>
              <span className="ct-format-ic" data-cat={format.cat}>
                <Icon name={CATEGORY_ICON[format.cat]} size={20} />
              </span>
              <h3 className="ct-format-title">{format.title}</h3>
              <p className="ct-format-desc">{format.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
