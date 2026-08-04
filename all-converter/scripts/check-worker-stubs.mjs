import { readFile } from 'node:fs/promises'

const workers = {
  image: { files: ['image.worker.ts'], evidence: ['createImageBitmap', 'convertToBlob'] },
  office: { files: ['office.worker.ts', 'office-operations.ts'], evidence: ['executeOfficeOperation', 'spreadsheet-convert', 'docx-to-pdf', 'md-to-pdf'] },
  'pdf-read': { files: ['pdf-read.worker.ts', 'pdf-operations.ts'], evidence: ['executePdfOperation', 'getDocument', 'pdf-to-images', 'pdf-to-md'] },
  'pdf-write': { files: ['pdf-write.worker.ts', 'pdf-operations.ts'], evidence: ['executePdfOperation', 'PDFDocument', 'pdf-merge'] },
  media: { files: ['media.worker.ts'], evidence: ['ffmpeg.exec', 'readFile'] },
  zip: { files: ['zip.worker.ts', 'zip-operations.ts'], evidence: ['executeZip', 'JSZip', 'generateAsync'] },
}

for (const [name, worker] of Object.entries(workers)) {
  const source = (await Promise.all(worker.files.map((file) => readFile(new URL(`../src/workers/${file}`, import.meta.url), 'utf8')))).join('\n')
  if (/\bTODO\b|not implemented|sin implementar/i.test(source)) throw new Error(`${name} contiene un marcador de implementación incompleta.`)
  for (const token of worker.evidence) if (!source.includes(token)) throw new Error(`${name} no contiene evidencia de ejecución real: ${token}.`)
}
console.log(`Workers verificados: ${Object.keys(workers).length} implementaciones reales.`)
