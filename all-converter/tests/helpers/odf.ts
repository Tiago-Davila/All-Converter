/**
 * Constructores de fixtures ODF (ODT/ODS) en memoria con jszip, para no versionar
 * blobs binarios. Estructura mínima que SheetJS acepta para ODS: mimetype (STORE) +
 * content.xml + styles.xml + META-INF/manifest.xml.
 */
import JSZip from 'jszip'

const ODS_MEDIA = 'application/vnd.oasis.opendocument.spreadsheet'
const ODT_MEDIA = 'application/vnd.oasis.opendocument.text'
const STYLES = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"></office:document-styles>'

function manifest(mediaType: string, paths: readonly string[]): string {
  const entries = paths.map((path) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${mediaType}"/>${entries}</manifest:manifest>`
}

async function packOdf(mediaType: string, files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', mediaType, { compression: 'STORE' })
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  zip.file('META-INF/manifest.xml', manifest(mediaType, Object.keys(files)))
  return zip.generateAsync({ type: 'uint8array' })
}

/** PNG rojo de 1×1 válido (IHDR + IDAT con CRC correcto), para probar imágenes. */
export const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

export function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_1x1_BASE64), (char) => char.charCodeAt(0))
}

export function odsContent(rows: readonly (readonly string[])[], sheet = 'Hoja1'): string {
  const body = rows
    .map((row) => `<table:table-row>${row.map((cell) => `<table:table-cell office:value-type="string"><text:p>${cell}</text:p></table:table-cell>`).join('')}</table:table-row>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="${sheet}">${body}</table:table></office:spreadsheet></office:body></office:document-content>`
}

export function buildOds(rows: readonly (readonly string[])[]): Promise<Uint8Array> {
  return packOdf(ODS_MEDIA, { 'content.xml': odsContent(rows), 'styles.xml': STYLES })
}

/** content.xml de ODT con estilo automático T1 = negrita, envolviendo `bodyXml`. */
export function odtContent(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`
}

/** Cuerpo ODT de ejemplo: encabezado, párrafo con negrita, lista, tabla e imagen. */
export const SAMPLE_ODT_BODY =
  '<text:h text:outline-level="1">Informe</text:h>' +
  '<text:p>Texto con <text:span text:style-name="T1">negrita</text:span> y normal.</text:p>' +
  '<text:list><text:list-item><text:p>Uno</text:p></text:list-item><text:list-item><text:p>Dos</text:p></text:list-item></text:list>' +
  '<table:table table:name="Tabla1"><table:table-row><table:table-cell><text:p>Producto</text:p></table:table-cell><table:table-cell><text:p>Precio</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Cafe</text:p></table:table-cell><table:table-cell><text:p>100</text:p></table:table-cell></table:table-row></table:table>' +
  '<text:p><draw:frame><draw:image xlink:href="Pictures/img.png"/></draw:frame></text:p>'

export function buildOdt(bodyXml: string = SAMPLE_ODT_BODY, pictures: Record<string, Uint8Array> = { 'Pictures/img.png': pngBytes() }): Promise<Uint8Array> {
  return packOdf(ODT_MEDIA, { 'content.xml': odtContent(bodyXml), 'styles.xml': STYLES, ...pictures })
}
