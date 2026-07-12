export function ResultDownload({ href, name }: { href: string; name: string }) { return <a href={href} download={name}>Descargar {name}</a> }
