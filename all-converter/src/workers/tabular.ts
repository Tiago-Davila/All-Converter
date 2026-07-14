export type FlatJsonRow = Record<string, string | number | boolean | null>

export function isFlatTabularJson(value: unknown): value is FlatJsonRow[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row) && Object.values(row).every((cell) => cell === null || ['string', 'number', 'boolean'].includes(typeof cell)))
}

function parseRows(text: string, separator: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index += 1 } else quoted = !quoted; continue }
    if (!quoted && char === separator) { row.push(field); field = ''; continue }
    if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(field); if (row.some((cell) => cell.length > 0)) rows.push(row); row = []; field = ''; continue }
    field += char
  }
  if (quoted) throw new Error('El CSV contiene un campo entrecomillado sin cerrar.')
  row.push(field); if (row.some((cell) => cell.length > 0)) rows.push(row)
  return rows
}

export function decodeCsv(bytes: ArrayBuffer): { rows: string[][]; separator: string } {
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(bytes)
  for (const separator of [',', ';', '\t', '|']) {
    const rows = parseRows(text, separator)
    if (rows.length && rows[0].length > 1 && rows.every((row) => row.length === rows[0].length)) return { rows, separator }
  }
  throw new Error('El CSV no tiene columnas consistentes. Reexportalo como UTF-8 con un delimitador válido.')
}
