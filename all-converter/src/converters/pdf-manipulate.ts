import type { PDFDocument } from 'pdf-lib'
import type { ConversionResult, Converter } from './types'

function parseRanges(input: string, pageCount: number): Array<[number, number]> {
  const ranges = input.split(',').map((part) => part.trim()).filter(Boolean).map((part): [number, number] => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!match) throw new Error(`Rango inválido: "${part}". Usá el formato "1-3, 7-10".`)
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (start < 1 || end > pageCount || start > end) throw new Error(`El rango "${part}" no existe en un PDF de ${pageCount} páginas.`)
    return [start, end]
  })
  if (!ranges.length) throw new Error('Indicá al menos un rango de páginas, por ejemplo "1-3, 7-10".')
  return ranges
}

async function saveAs(pdf: PDFDocument, name: string): Promise<ConversionResult> {
  const output = new Uint8Array(await pdf.save())
  return { name, mime: 'application/pdf', buffer: output.buffer, sizeBytes: output.byteLength, previewKind: 'pdf' }
}

export const pdfMergeConverter: Converter = { id: 'pdf-merge', label: 'Unir PDFs', from: ['pdf'], to: 'pdf', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const extras = Array.isArray(options.mergeWith) ? options.mergeWith.filter((entry): entry is File => entry instanceof File) : []
    if (!extras.length) throw new Error('Para unir PDFs se necesitan al menos dos archivos.')
    const { PDFDocument } = await import('pdf-lib')
    const merged = await PDFDocument.create()
    const sources = [file, ...extras]
    for (const [index, source] of sources.entries()) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      const doc = await PDFDocument.load(await source.arrayBuffer())
      for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page)
      onProgress({ percent: Math.round(((index + 1) / sources.length) * 100), stage: `Uniendo ${source.name}` })
    }
    return [await saveAs(merged, file.name.replace(/\.pdf$/i, '-unido.pdf'))]
  }
}

export const pdfSplitConverter: Converter = { id: 'pdf-split', label: 'Dividir PDF', from: ['pdf'], to: 'pdf', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const { PDFDocument } = await import('pdf-lib')
    const source = await PDFDocument.load(await file.arrayBuffer())
    const ranges = parseRanges(String(options.ranges ?? ''), source.getPageCount())
    const base = file.name.replace(/\.pdf$/i, '')
    const results: ConversionResult[] = []
    for (const [index, [start, end]] of ranges.entries()) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
      const part = await PDFDocument.create()
      const indices = Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset)
      for (const page of await part.copyPages(source, indices)) part.addPage(page)
      results.push(await saveAs(part, `${base}-p${start}-${end}.pdf`))
      onProgress({ percent: Math.round(((index + 1) / ranges.length) * 100), stage: `Rango ${start}-${end}` })
    }
    return results
  }
}

export const pdfRotateConverter: Converter = { id: 'pdf-rotate', label: 'Rotar PDF', from: ['pdf'], to: 'pdf', maxSizeMB: 25,
  async convert(file, onProgress, options, signal) {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    const angle = Number(options.degrees ?? 90)
    if (![90, 180, 270].includes(angle)) throw new Error('La rotación debe ser de 90, 180 o 270 grados.')
    const { PDFDocument, degrees } = await import('pdf-lib')
    const pdf = await PDFDocument.load(await file.arrayBuffer())
    const selected = Array.isArray(options.pages) ? options.pages.map(Number) : null
    pdf.getPages().forEach((page, index) => {
      if (selected && !selected.includes(index + 1)) return
      page.setRotation(degrees((page.getRotation().angle + angle) % 360))
    })
    onProgress({ percent: 100, stage: 'Páginas rotadas' })
    return [await saveAs(pdf, file.name.replace(/\.pdf$/i, '-rotado.pdf'))]
  }
}
