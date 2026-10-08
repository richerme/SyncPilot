// Texto de un .docx sin dependencias (solo servidor). Un .docx es un ZIP; el texto
// vive en word/document.xml. Antes los Word se guardaban sin texto y el Copiloto no
// los veía (las especificaciones funcionales suelen venir en Word).
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

function readEntry(zip: Buffer, wanted: string): Buffer | null {
  // Fin del directorio central: en los últimos 64 KB + 22 bytes.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== CENTRAL_SIG) return null
    const method = zip.readUInt16LE(p + 10)
    const compressed = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === wanted) {
      if (zip.readUInt32LE(localOffset) !== LOCAL_SIG) return null
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
      const data = zip.subarray(start, start + compressed)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      return null
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/** Párrafos del documento separados por línea en blanco; '' si no se pudo leer. */
export function extractDocxText(file: Buffer): string {
  try {
    const xml = readEntry(file, 'word/document.xml')?.toString('utf8')
    if (!xml) return ''
    return xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(amp|lt|gt|quot|apos);/g, m => ENTITIES[m])
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  } catch {
    return ''
  }
}
