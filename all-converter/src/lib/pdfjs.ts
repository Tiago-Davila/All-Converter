export async function loadPdfJs() {
  // El build moderno exige APIs de navegador (DOMMatrix); en Node (Vitest) se usa el build legacy oficial.
  if (typeof DOMMatrix === 'undefined') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    return pdfjs
  }
  // workerSrc apunta al asset del bundle local (nunca CDN, requerido por COEP).
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}
