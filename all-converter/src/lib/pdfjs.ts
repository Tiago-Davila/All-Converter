export async function loadPdfJs() {
  // Vitest ejecuta en Node; producción usa siempre el build moderno también dentro del worker de dominio.
  if (import.meta.env.MODE === 'test') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    return pdfjs
  }
  // workerSrc apunta al asset del bundle local (nunca CDN, requerido por COEP).
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}
