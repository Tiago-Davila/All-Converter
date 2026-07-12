import JSZip from 'jszip'
export async function createZip(files: readonly { name: string; buffer: ArrayBuffer }[]): Promise<ArrayBuffer> { const zip = new JSZip(); files.forEach((file) => zip.file(file.name, file.buffer)); return (await zip.generateAsync({ type: 'arraybuffer' })) }
