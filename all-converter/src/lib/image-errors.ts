export function imageErrorMessage(error: unknown): string {
  if (error instanceof RangeError || error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'El navegador no tiene memoria suficiente. Probá con un archivo más chico.'
  }
  return error instanceof Error ? error.message : 'No se pudo convertir la imagen.'
}
