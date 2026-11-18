import { readFile } from 'node:fs/promises'

const workers = {
  image: { files: ['image.worker.ts'], evidence: ['createImageBitmap', 'convertToBlob'] },
  office: { files: ['office.worker.ts', 'office-operations.ts'], evidence: ['executeOfficeOperation', 'spreadsheet-convert', 'docx-to-pdf', 'md-to-pdf'] },
  'pdf-read': { files: ['pdf-read.worker.ts', 'pdf-operations.ts'], evidence: ['executePdfOperation', 'getDocument', 'pdf-to-images', 'pdf-to-md'] },
  'pdf-write': { files: ['pdf-write.worker.ts', 'pdf-operations.ts'], evidence: ['executePdfOperation', 'PDFDocument', 'pdf-merge'] },
  media: { files: ['media.worker.ts'], evidence: ['ffmpeg.exec', 'readFile'] },
  // El ZIP ya no lo escribe JSZip sino un generador STORE incremental propio (006 research D1).
  zip: { files: ['zip.worker.ts', 'zip-operations.ts'], evidence: ['executeZip', 'streamZip', 'crc32', 'SIGNATURE_LOCAL'] },
}

for (const [name, worker] of Object.entries(workers)) {
  const source = (await Promise.all(worker.files.map((file) => readFile(new URL(`../src/workers/${file}`, import.meta.url), 'utf8')))).join('\n')
  // `TODO` va sin `i`: en minúsculas es una palabra corriente en castellano y "método" incluso
  // la contiene entre bordes de palabra, porque la `é` no es un carácter de palabra para \b.
  if (/\bTODO\b/.test(source) || /not implemented|sin implementar/i.test(source)) throw new Error(`${name} contiene un marcador de implementación incompleta.`)
  for (const token of worker.evidence) if (!source.includes(token)) throw new Error(`${name} no contiene evidencia de ejecución real: ${token}.`)
}
console.log(`Workers verificados: ${Object.keys(workers).length} implementaciones reales.`)
