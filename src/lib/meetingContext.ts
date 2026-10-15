// Contexto de cada reunión (PRP-003, solo servidor): los documentos activos COMPLETOS en un
// caché de Gemini (con las instrucciones del Copiloto), un resumen de qué trata la reunión y
// los términos que se van a mencionar (para el reconocimiento de voz).
//
// Medido el 15 oct: 198k caracteres de documentos + 30k de reunión (78k tokens) → primera
// palabra del Copiloto en 1.25-1.8 s sin caché y 0.9-1.3 s con caché; el caché se crea en 0.6 s.
//
// El registro vive en memoria del servidor (un solo proceso). Si el servidor se reinicia a
// media reunión, se vuelve a armar en la siguiente pregunta; los cachés huérfanos caducan solos.
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getGenAI } from '@/lib/openrouter'
import { GEMINI_MODELS, NO_THINKING } from '@/lib/geminiModels'
import { reextractStoredDocument, type DocumentExt } from '@/lib/documentText'
import { COPILOT_INSTRUCTIONS } from '@/features/live/copilot/profile'

const CACHE_TTL_S      = 3 * 3600
const RENEW_BEFORE_MS  = 20 * 60_000
const MIN_CACHE_CHARS  = 8_000      // ~2k tokens: con menos, los documentos van directo en el prompt
const MAX_DOCS_CHARS   = 2_400_000  // ~600k tokens: más allá, se usa la búsqueda por fragmentos
const BRIEF_DOC_CHARS  = 800_000
const MAX_TERMS        = 100

export interface MeetingDocsInfo { name: string; chars: number }

export interface MeetingContext {
  key: string
  docs: MeetingDocsInfo[]
  /** Documentos completos para el prompt cuando no hay caché ('' si van en el caché o no hay). */
  inlineDocs: string
  /** true si los documentos no caben completos y hay que elegir fragmentos (lib/docContext). */
  tooLarge: boolean
  cacheName: string | null
  expiresAt: number
  brief: string
  terms: string[]
}

const registry = new Map<string, MeetingContext>()
const building = new Map<string, Promise<MeetingContext>>()
const refreshed = new Set<string>() // documentos ya releídos en este proceso

// Señales de que un documento quedó cortado con los topes de antes (50k caracteres; PDF ~8k tokens).
function looksTruncated(d: { fileType: string; extractedText: string | null }): boolean {
  const n = d.extractedText?.length ?? 0
  return (n >= 49_000 && n <= 50_000) || (d.fileType === 'pdf' && n >= 20_000 && n < 60_000)
}

async function loadActiveDocs(userId: string): Promise<{ name: string; text: string }[]> {
  const rows = await prisma.contextDocument.findMany({
    where: { userId, isActive: true },
    select: { id: true, name: true, fileType: true, storagePath: true, extractedText: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const d of rows) {
    if (refreshed.has(d.id) || !(looksTruncated(d) || !d.extractedText)) continue
    refreshed.add(d.id)
    const text = await reextractStoredDocument(d.storagePath, d.fileType as DocumentExt).catch(() => null)
    if (text && text.length > (d.extractedText?.length ?? 0)) {
      d.extractedText = text
      await prisma.contextDocument.update({ where: { id: d.id }, data: { extractedText: text } }).catch(() => {})
    }
  }
  return rows.filter(d => d.extractedText?.trim()).map(d => ({ name: d.name, text: d.extractedText as string }))
}

export function formatDocs(docs: { name: string; text: string }[]): string {
  return docs.map(d => `===== DOCUMENT: ${d.name} =====\n${d.text.trim()}`).join('\n\n')
}

export async function buildBrief(docsText: string): Promise<{ brief: string; terms: string[] }> {
  const ai = getGenAI()
  if (!ai || !docsText) return { brief: '', terms: [] }
  try {
    const r = await ai.models.generateContent({
      model: GEMINI_MODELS.copilot,
      contents: [{ role: 'user', parts: [{ text: docsText.slice(0, BRIEF_DOC_CHARS) }] }],
      config: {
        systemInstruction: 'Preparas a Rick, consultor SAP ABAP, para una reunión de trabajo a partir de sus documentos. '
          + 'Devuelve JSON {"resumen": string, "terminos": string[]}. '
          + '"resumen": en español, de 4 a 7 viñetas cortas que empiecen con "• ": de qué trata la reunión, procesos y objetos SAP involucrados, pendientes o decisiones abiertas, y las preguntas que probablemente le harán. Sin inventar nada que no esté en los documentos. '
          + `"terminos": hasta ${MAX_TERMS} términos exactos que se van a mencionar en voz alta (objetos Z, transacciones, tablas, BAdIs, IDocs, sistemas, nombres de personas y de la empresa), tal como aparecen en los documentos.`,
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: NO_THINKING,
      },
    })
    const data = JSON.parse(r.text ?? '{}') as { resumen?: unknown; terminos?: unknown }
    const brief = typeof data.resumen === 'string' ? data.resumen.trim() : ''
    const terms = Array.isArray(data.terminos) ? data.terminos.filter((t): t is string => typeof t === 'string' && t.trim().length > 1).map(t => t.trim().slice(0, 60)).slice(0, MAX_TERMS) : []
    return { brief, terms }
  } catch (err) {
    console.warn('[meetingContext] resumen:', err instanceof Error ? err.message.slice(0, 200) : err)
    return { brief: '', terms: [] }
  }
}

async function createCache(docsText: string): Promise<{ name: string; expiresAt: number } | null> {
  const ai = getGenAI()
  if (!ai) return null
  try {
    const cache = await ai.caches.create({
      model: GEMINI_MODELS.copilot,
      config: {
        systemInstruction: COPILOT_INSTRUCTIONS,
        contents: [{ role: 'user', parts: [{ text: `REFERENCE DOCUMENTS (complete):\n\n${docsText}` }] }],
        ttl: `${CACHE_TTL_S}s`,
      },
    })
    return cache.name ? { name: cache.name, expiresAt: Date.now() + CACHE_TTL_S * 1000 } : null
  } catch (err) {
    console.warn('[meetingContext] caché:', err instanceof Error ? err.message.slice(0, 200) : err)
    return null
  }
}

async function build(meetingId: string, docs: { name: string; text: string }[], key: string): Promise<MeetingContext> {
  const docsText = formatDocs(docs)
  const tooLarge = docsText.length > MAX_DOCS_CHARS
  const useCache = !tooLarge && docsText.length >= MIN_CACHE_CHARS
  const [cache, brief] = await Promise.all([useCache ? createCache(docsText) : Promise.resolve(null), buildBrief(docsText)])
  const ctx: MeetingContext = {
    key,
    docs: docs.map(d => ({ name: d.name, chars: d.text.length })),
    inlineDocs: cache || tooLarge ? '' : docsText,
    tooLarge,
    cacheName: cache?.name ?? null,
    expiresAt: cache?.expiresAt ?? 0,
    ...brief,
  }
  registry.set(meetingId, ctx)
  return ctx
}

/** Contexto de la reunión: lo arma la primera vez y lo rehace si cambiaron los documentos activos. */
export async function getMeetingContext(userId: string, meetingId: string): Promise<MeetingContext> {
  const pending = building.get(meetingId)
  if (pending) return pending
  const docs = await loadActiveDocs(userId)
  const key = createHash('sha1').update(docs.map(d => `${d.name}:${d.text.length}`).join('|')).digest('hex')
  const current = registry.get(meetingId)
  if (current && current.key === key && await renewIfNeeded(current)) return current
  if (current?.cacheName) void deleteCache(current.cacheName)
  const job = build(meetingId, docs, key).finally(() => building.delete(meetingId))
  building.set(meetingId, job)
  return job
}

/** Alarga el caché si está por caducar. false = ya no existe y hay que rearmar el contexto. */
async function renewIfNeeded(ctx: MeetingContext): Promise<boolean> {
  if (!ctx.cacheName || ctx.expiresAt - Date.now() > RENEW_BEFORE_MS) return true
  try {
    await getGenAI()?.caches.update({ name: ctx.cacheName, config: { ttl: `${CACHE_TTL_S}s` } })
    ctx.expiresAt = Date.now() + CACHE_TTL_S * 1000
    return true
  } catch {
    registry.delete([...registry].find(([, c]) => c === ctx)?.[0] ?? '')
    return false
  }
}

async function deleteCache(name: string) {
  await getGenAI()?.caches.delete({ name }).catch(() => {})
}

/** Al terminar la reunión: borra el caché (si no, caduca solo a las 3 h). */
export async function releaseMeetingContext(meetingId: string) {
  const ctx = registry.get(meetingId)
  registry.delete(meetingId)
  if (ctx?.cacheName) await deleteCache(ctx.cacheName)
}
