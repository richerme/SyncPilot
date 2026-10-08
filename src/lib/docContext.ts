// Contexto de los documentos para el Copiloto (solo servidor).
// Antes el navegador mandaba los primeros 3,000 caracteres de los documentos, así que
// casi todo lo subido se ignoraba. Ahora se parte cada documento en fragmentos y se
// eligen los que más palabras comparten con la pregunta y la conversación (sin
// embeddings: los términos SAP —transacciones, objetos, tablas— coinciden tal cual).
import { prisma } from '@/lib/db'

const CHUNK_CHARS = 1200
const STOPWORDS = new Set(('the and for are you can that this with have from what when will would could should about there their they them your our was were has had not but all any how who why which also into than then just like here more some such only very does did been being '
  + 'que los las del por para con una uno unos unas como pero sus este esta estos estas ese esa eso entre cuando donde sobre tiene tienen hay ser son fue era muy más mas también tambien porque desde hasta nos les ellos ellas usted ustedes').split(/\s+/))

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_/]{3,}/gu) ?? []).filter(t => !STOPWORDS.has(t))
}

function chunk(name: string, text: string): string[] {
  // Un párrafo enorme se corta en pedazos del tamaño del fragmento.
  const pieces = text.split(/\n\s*\n/).flatMap(p => {
    const parts: string[] = []
    for (let i = 0; i < p.length; i += CHUNK_CHARS) parts.push(p.slice(i, i + CHUNK_CHARS))
    return parts
  })
  const out: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > CHUNK_CHARS) {
      out.push(current)
      current = ''
    }
    current += (current ? '\n\n' : '') + piece
  }
  if (current.trim()) out.push(current)
  return out.map(c => `[${name}]\n${c.trim()}`)
}

/** Fragmentos de los documentos activos más relacionados con `query`, hasta `maxChars`. */
export async function relevantDocContext(userId: string, query: string, maxChars = 12000): Promise<string> {
  const docs = await prisma.contextDocument.findMany({
    where: { userId, isActive: true, extractedText: { not: null } },
    select: { name: true, extractedText: true },
    orderBy: { createdAt: 'desc' },
  })
  return selectRelevant(docs.map(d => ({ name: d.name, text: d.extractedText ?? '' })), query, maxChars)
}

/** Lógica pura (probada aparte): parte, puntúa y elige fragmentos. */
export function selectRelevant(docs: { name: string; text: string }[], query: string, maxChars: number): string {
  const chunks = docs.flatMap(d => chunk(d.name, d.text))
  if (!chunks.length) return ''
  const total = chunks.reduce((n, c) => n + c.length, 0)
  if (total <= maxChars) return chunks.join('\n\n---\n\n')

  const weights = new Map<string, number>()
  for (const t of terms(query)) weights.set(t, (weights.get(t) ?? 0) + 1)
  const scored = chunks.map((text, index) => {
    const found = new Set(terms(text))
    let score = 0
    for (const [t, w] of weights) if (found.has(t)) score += w
    return { text, index, score }
  })
  const picked: typeof scored = []
  let used = 0
  for (const c of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + c.text.length > maxChars) continue
    picked.push(c)
    used += c.text.length
  }
  // En el orden original del documento, para que se lean con sentido.
  return picked.sort((a, b) => a.index - b.index).map(c => c.text).join('\n\n---\n\n')
}
