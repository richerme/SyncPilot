// Texto de los documentos de contexto (solo servidor). Se lee COMPLETO: el Copiloto
// trabaja con todos los documentos activos en cada reunión (PRP-003). Antes se cortaba
// a 50,000 caracteres y los PDF a lo que cupiera en 8,192 tokens.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { extractTextFromPdf } from '@/lib/openrouter'
import { extractDocxText } from '@/lib/docx'

export const DOC_TEXT_MAX = 1_000_000
export const DOCUMENT_TYPES = ['pdf', 'txt', 'md', 'docx'] as const
export type DocumentExt = typeof DOCUMENT_TYPES[number]

export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

/** .txt/.md directo, .docx desde word/document.xml, .pdf con Gemini (lee PDF nativo). */
export async function extractDocumentText(ext: DocumentExt, buffer: Buffer): Promise<string | null> {
  let text = ''
  if (ext === 'txt' || ext === 'md') text = buffer.toString('utf-8')
  else if (ext === 'docx') text = extractDocxText(buffer)
  else if (ext === 'pdf') text = await extractTextFromPdf(buffer.toString('base64'))
  return text.trim() ? text.slice(0, DOC_TEXT_MAX) : null
}

/** Vuelve a leer un documento ya subido (storagePath relativo a UPLOAD_DIR). */
export async function reextractStoredDocument(storagePath: string, ext: DocumentExt): Promise<string | null> {
  const base = path.resolve(uploadDir())
  const file = path.resolve(base, storagePath)
  if (!file.startsWith(base + path.sep)) return null // nunca fuera de la carpeta de subidas
  return extractDocumentText(ext, await readFile(file))
}
