export function normalizePdfError(error: unknown): Error {
  const original = error instanceof Error ? error : undefined
  const signature = `${original?.name ?? ''} ${original?.message ?? ''}`.toLowerCase()
  if (/password|encrypted|encryption/.test(signature)) return new Error('El PDF está protegido con contraseña. Desbloquealo antes de convertirlo.')
  if (/invalidpdf|invalid pdf|parse|header|corrupt|truncated|unexpected eof/.test(signature)) return new Error('El archivo parece estar dañado o incompleto. Descargalo nuevamente e intentá otra vez.')
  return original ?? new Error('No se pudo procesar el PDF. Verificá que el archivo sea válido.')
}
