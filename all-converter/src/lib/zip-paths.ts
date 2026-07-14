export interface PathEntry { name: string; relativePath?: string }

export function resolveZipPaths(entries: readonly PathEntry[]): string[] {
  const used = new Set<string>()
  return entries.map((entry) => {
    const directory = entry.relativePath?.includes('/') ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/') + 1) : ''
    const dot = entry.name.lastIndexOf('.'); const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name; const extension = dot > 0 ? entry.name.slice(dot) : ''
    let candidate = `${directory}${entry.name}`
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${directory}${stem}-${suffix}${extension}`
    used.add(candidate); return candidate
  })
}
