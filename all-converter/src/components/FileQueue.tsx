import type { FileEntry } from '../converters/types'
import { ConversionCard } from './ConversionCard'
export function FileQueue({ entries }: { entries: readonly FileEntry[] }) { return <ul aria-label="Cola de archivos">{entries.map((entry) => <ConversionCard key={entry.id} entry={entry} />)}</ul> }
