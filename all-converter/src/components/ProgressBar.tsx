export function ProgressBar({ value }: { value?: number }) { return <progress aria-label="Progreso de conversión" value={value} max={100}>{value ?? 0}%</progress> }
