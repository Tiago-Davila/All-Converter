import type { FileEntry } from '../converters/types'
export function ConversionCard({ entry }: { entry: FileEntry }) { return <li><strong>{entry.name}</strong><span>{entry.detectedType.mime || 'Tipo desconocido'}</span><span>{entry.state}</span>{entry.rejectionReason && <p role="alert">{entry.rejectionReason}</p>}</li> }
