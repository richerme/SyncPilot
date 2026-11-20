// «Investigar» del Copiloto (PRP-004, fase 2), 10 nov 2026.
//
// El botón toma la pregunta y lo que se está hablando en la reunión, pero a internet SOLO sale una
// pregunta técnica genérica. Dos pasos:
//   1. Reescribir (sin búsqueda): el modelo ve la pregunta, la primera respuesta y el final de la
//      reunión, y devuelve una pregunta de SAP estándar sin nombres del cliente, personas, sistemas,
//      objetos Z/Y ni números del proyecto. Después un filtro fijo (scrubQuery) quita lo que se le
//      haya escapado: objetos Z/Y, correos, URLs, números largos, SID-mandante y los términos propios
//      que salieron de los documentos de la reunión.
//   2. Buscar: Gemini con Google Search (grounding) recibe ÚNICAMENTE esa pregunta, nunca la reunión,
//      así que las consultas que llegan a Google salen de ella. Respaldo: OpenRouter con el plugin web.
//
// Términos de Google para el grounding: el resultado se muestra sin modificar, con sus enlaces y las
// «Search Suggestions» (searchEntryPoint) solo al usuario que lo pidió.
// Sin dependencias de Next ni de la BD, para probarlo solo (scripts/test-copilot-research.ts).
import type { GoogleGenAI } from '@google/genai'
import { GEMINI_MODELS, NO_THINKING } from './geminiModels'
import { classifyAiError, CopilotUnavailableError, type ProviderFailure } from './copilotAnswer'

export interface ResearchSource { title: string; domain: string; url: string }
export interface SearchOutcome { text: string; sources: ResearchSource[]; searchQueries: string[]; suggestionsHtml: string }
export interface ResearchOutcome extends SearchOutcome {
  provider: string; query: string; removed: string[]; failures: ProviderFailure[]; ms: { rewrite: number; search: number }
}
export interface ResearchInput { question: string | null; firstAnswer: string; transcriptTail: string; blockedTerms: string[] }
export interface Step<I, O> { name: string; run: (input: I) => Promise<O> }

/** La pregunta es solo del proyecto (estado, fechas, quién): no hay nada que buscar en internet. */
export class NothingToSearchError extends Error {
  constructor() { super('Esa pregunta es del proyecto (estado, fechas o personas): no hay nada que buscar en internet.'); this.name = 'NothingToSearchError' }
}

export const REWRITE_SYSTEM = `You prepare ONE web search question for an SAP ABAP consultant during a live client meeting.
Return JSON {"query": string}.
- The query is a generic technical question about STANDARD SAP, in English, at most 25 words.
- Keep standard SAP terms: products and releases (S/4HANA 2023, ECC 6.0, ABAP Cloud, BTP), standard transactions (VA01, WE19), standard tables, CDS views, BAdIs, classes, function modules, BAPIs, IDoc types and concepts.
- REMOVE everything that identifies the project or the client: company and client names, people, cities, system IDs (SIDs) and client numbers, hostnames, project or team names, custom objects (names starting with Z or Y, or in a customer namespace), ticket, order or document numbers, amounts and dates of the project.
- If the question is only about project facts (status, dates, estimates, who does what), return {"query": ""}.`

export const SEARCH_SYSTEM = `You are a senior SAP ABAP consultant. Answer the question in English in 2 to 4 short sentences using current web results. Mention the SAP release or edition when it matters. If sources disagree or it depends on the release, say so.`

/** Lo mismo, pero contestando en el idioma que se habla en la reunión (Investigar libre, PRP-005). */
export function searchSystem(language: string): string {
  return SEARCH_SYSTEM.replace('in English', `in ${languageName(language)}`)
}

// ── «Investigar» libre (PRP-005, fase 1): de qué se está hablando ahora ──────────────────────────
// Sin pregunta ni respuesta: el modelo lee lo último de la reunión y devuelve, en el idioma en que se
// está hablando, los últimos puntos (solo para el usuario) y UNA pregunta técnica genérica que es lo
// único que sale a internet, con las mismas reglas de REWRITE_SYSTEM y después scrubQuery.
export const CONTEXT_SYSTEM = `You help an SAP ABAP consultant who is in a live meeting and wants to understand what is being discussed right now.
You get the latest part of the meeting transcript (oldest first; the END is what is being discussed now). Lines marked "Rick:" are the consultant who uses this tool; lines marked "Meeting:" are the other participants (so a question in a "Meeting:" line is asked TO Rick).
Return JSON {"language": string, "points": string[], "query": string}.
- "language": ISO 639-1 code of the language spoken in the LAST lines of the transcript (for example "es" or "en").
- "points": 2 to 4 short bullet points, written in that language, about the LATEST points of the conversation (give the most weight to the last lines). Explain any technical term in a few words inside the point. No greetings, no advice, no invented facts.
- "query": ONE generic technical question about STANDARD SAP, in English, at most 25 words, that would help understand the main technical topic of those latest points. Keep standard SAP terms (products and releases, standard transactions, tables, CDS views, BAdIs, classes, function modules, BAPIs, IDoc types). REMOVE everything that identifies the project or the client: company and client names, people, cities, system IDs and client numbers, hostnames, project or team names, custom objects (names starting with Z or Y, or in a customer namespace), ticket, order or document numbers, amounts and dates. If the latest points are only about project facts (status, dates, estimates, who does what), use "".`

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
}

/** Nombre del idioma para las instrucciones del modelo (código ISO 639-1; si no se conoce, inglés). */
export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.trim().toLowerCase().slice(0, 2)] ?? 'English'
}

export interface ContextSummary { language: string; points: string[]; query: string }

export function contextUserPrompt(transcriptTail: string): string {
  return `LATEST MEETING TRANSCRIPT (the end is what is being discussed now):\n${transcriptTail.slice(-6000) || '(empty)'}`
}

export function parseContext(text: string): ContextSummary {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    const j = JSON.parse(m ? m[0] : text) as { language?: unknown; points?: unknown; query?: unknown }
    const lang = typeof j.language === 'string' && /^[a-z]{2}/i.test(j.language.trim()) ? j.language.trim().slice(0, 2).toLowerCase() : 'en'
    const points = Array.isArray(j.points) ? j.points.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => p.trim().slice(0, 400)).slice(0, 4) : []
    return { language: lang, points, query: typeof j.query === 'string' ? j.query.trim() : '' }
  } catch { return { language: 'en', points: [], query: '' } }
}

export interface ContextOutcome { language: string; points: string[]; query: string; removed: string[]; provider: string; failures: ProviderFailure[]; ms: number }

/** Paso único (sin internet): últimos puntos + pregunta técnica ya filtrada. La búsqueda va aparte. */
export async function runContextSummary(transcriptTail: string, blockedTerms: string[], steps: Step<string, string>[]): Promise<ContextOutcome> {
  const failures: ProviderFailure[] = []
  const t0 = Date.now()
  const done = await firstThatWorks(steps, contextUserPrompt(transcriptTail), failures)
  const parsed = parseContext(done.out)
  const { query, removed } = scrubQuery(parsed.query, blockedTerms)
  return {
    language: parsed.language, points: parsed.points,
    query: query.split(/\s+/).filter(Boolean).length < 3 ? '' : query,
    removed, provider: done.name, failures, ms: Date.now() - t0,
  }
}

/** Búsqueda de una pregunta ya filtrada (segunda parte de Investigar libre). Se vuelve a filtrar aquí. */
export async function runQuerySearch(query: string, blockedTerms: string[], steps: Step<string, SearchOutcome>[]): Promise<ResearchOutcome> {
  const failures: ProviderFailure[] = []
  const clean = scrubQuery(query, blockedTerms)
  if (clean.query.split(/\s+/).filter(Boolean).length < 3) throw new NothingToSearchError()
  const t0 = Date.now()
  const found = await firstThatWorks(steps, clean.query, failures)
  return { ...found.out, provider: found.name, query: clean.query, removed: clean.removed, failures, ms: { rewrite: 0, search: Date.now() - t0 } }
}

export function rewriteUserPrompt(input: Omit<ResearchInput, 'blockedTerms'>): string {
  return [
    `QUESTION: ${input.question?.trim() || '(not typed: use the latest question addressed to the consultant in the transcript)'}`,
    input.firstAnswer.trim() ? `FIRST ANSWER GIVEN IN THE MEETING:\n${input.firstAnswer.trim().slice(0, 2000)}` : '',
    `RECENT MEETING TRANSCRIPT (context only; never copy names or project data from it):\n${input.transcriptTail.slice(-4000) || '(empty)'}`,
  ].filter(Boolean).join('\n\n')
}

export function parseRewrite(text: string): string {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    const q = (JSON.parse(m ? m[0] : text) as { query?: unknown }).query
    return typeof q === 'string' ? q.trim() : ''
  } catch { return '' }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasWord = (text: string, term: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text)

/**
 * Qué términos de la reunión (los que salen de sus documentos) son del proyecto y no deben salir:
 * nombres de personas y empresas, objetos Z/Y, siglas que no son de SAP. Se quedan los que aparecen
 * en el vocabulario estándar (know-how + términos de SAP) y los que parecen transacciones (VA01, ME21N).
 */
export function blockedTermsFrom(terms: string[], standardVocabulary: string): string[] {
  const isProprietary = (t: string) => {
    if (t.length < 2) return false
    if (/^[ZY][A-Z0-9_/]+$/.test(t) || /^[zy][a-z0-9]*_[a-z0-9_]+$/.test(t)) return true // objetos propios
    if (hasWord(standardVocabulary, t)) return false
    if (/^[A-Z]{1,5}\d{1,3}[A-Z]?$/.test(t)) return false // transacciones estándar como VA01, ME21N, SE38
    return true
  }
  const out = new Set<string>()
  for (const t of terms.map(x => x.trim()).filter(isProprietary)) {
    out.add(t)
    // «Laura Méndez» también bloquea «Laura» y «Méndez» por separado (el modelo puede dejar uno).
    for (const w of t.split(/\s+/)) if (w.length >= 3 && /^\p{Lu}/u.test(w) && isProprietary(w)) out.add(w)
  }
  return [...out]
}

const FIXED_PATTERNS: [RegExp, string][] = [
  [/https?:\/\/\S+/gi, 'url'],
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, 'correo'],
  [/\b[ZY][A-Z0-9_/]{2,}\b/g, 'objeto Z/Y'],
  [/\b[zy][a-z0-9]*_[a-z0-9_]+\b/g, 'objeto Z/Y'],
  [/\b[A-Z][A-Z0-9]{2}[/-]\d{3}\b/g, 'SID-mandante'],
  [/\bclient\s+\d{3}\b/gi, 'mandante'],
  [/\b\d{5,}\b/g, 'número'],
]

/** Filtro fijo después de la reescritura: lo que se le escape al modelo no sale a internet. */
export function scrubQuery(query: string, blockedTerms: string[]): { query: string; removed: string[] } {
  const removed: string[] = []
  let q = query
  // Primero los patrones completos (un correo o un SID-mandante), luego los términos sueltos.
  for (const [re, label] of FIXED_PATTERNS) {
    if (re.test(q)) { removed.push(label); q = q.replace(re, '') }
    re.lastIndex = 0
  }
  for (const term of [...blockedTerms].sort((a, b) => b.length - a.length)) {
    if (!hasWord(q, term)) continue
    removed.push(term)
    q = q.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(term)}(?=$|[^\\p{L}\\p{N}_])('s)?`, 'giu'), '$1')
  }
  q = q.replace(/\s+([,.?;:])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:]+/, '').trim()
  return { query: q, removed }
}

function domainOf(url: string, title: string): string {
  if (/^[\w-]+(\.[\w-]+)+$/.test(title)) return title.toLowerCase() // Gemini pone el dominio como título
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function uniqueSources(list: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>()
  return list.filter(s => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 3)
}

interface GroundingLike {
  text?: string
  candidates?: { groundingMetadata?: {
    webSearchQueries?: string[]
    groundingChunks?: { web?: { uri?: string; title?: string; domain?: string } }[]
    searchEntryPoint?: { renderedContent?: string }
  } }[]
}

export function parseGeminiGrounding(r: GroundingLike): SearchOutcome {
  const g = r.candidates?.[0]?.groundingMetadata
  const sources = (g?.groundingChunks ?? []).map(c => {
    const url = c.web?.uri ?? '', title = c.web?.title ?? ''
    return { title: title || c.web?.domain || 'Fuente', domain: c.web?.domain || domainOf(url, title), url }
  })
  return { text: (r.text ?? '').trim(), sources: uniqueSources(sources), searchQueries: g?.webSearchQueries ?? [], suggestionsHtml: g?.searchEntryPoint?.renderedContent ?? '' }
}

interface OpenRouterLike { choices?: { message?: { content?: string; annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[] } }[] }

export function parseOpenRouterSearch(j: OpenRouterLike): SearchOutcome {
  const m = j.choices?.[0]?.message
  const sources = (m?.annotations ?? []).filter(a => a.type === 'url_citation' && a.url_citation?.url).map(a => {
    const url = a.url_citation?.url ?? '', title = a.url_citation?.title ?? ''
    return { title: title || domainOf(url, ''), domain: domainOf(url, ''), url }
  })
  return { text: (m?.content ?? '').trim(), sources: uniqueSources(sources), searchQueries: [], suggestionsHtml: '' }
}

async function firstThatWorks<I, O>(steps: Step<I, O>[], input: I, failures: ProviderFailure[]): Promise<{ name: string; out: O }> {
  for (const s of steps) {
    try { return { name: s.name, out: await s.run(input) } } catch (err) {
      failures.push({ provider: s.name, kind: classifyAiError(err), detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) })
    }
  }
  throw new CopilotUnavailableError(failures)
}

/** Paso 1 (reescribir) y paso 2 (buscar SOLO con la pregunta limpia), cada uno con respaldo. */
export async function runResearch(input: ResearchInput, steps: { rewrite: Step<string, string>[]; search: Step<string, SearchOutcome>[] }): Promise<ResearchOutcome> {
  const failures: ProviderFailure[] = []
  const t0 = Date.now()
  const rewritten = await firstThatWorks(steps.rewrite, rewriteUserPrompt(input), failures)
  const { query, removed } = scrubQuery(parseRewrite(rewritten.out), input.blockedTerms)
  if (query.split(/\s+/).filter(Boolean).length < 3) throw new NothingToSearchError()
  const t1 = Date.now()
  const found = await firstThatWorks(steps.search, query, failures)
  return { ...found.out, provider: found.name, query, removed, failures, ms: { rewrite: t1 - t0, search: Date.now() - t1 } }
}

// ── Proveedores reales ────────────────────────────────────────────────────────────────────────

export function geminiRewriteStep(ai: GoogleGenAI): Step<string, string> {
  return { name: 'Gemini', run: async (prompt) => {
    const r = await ai.models.generateContent({
      model: GEMINI_MODELS.copilot, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: REWRITE_SYSTEM, temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', thinkingConfig: NO_THINKING },
    })
    return r.text ?? ''
  } }
}

export function geminiContextStep(ai: GoogleGenAI): Step<string, string> {
  return { name: 'Gemini', run: async (prompt) => {
    const r = await ai.models.generateContent({
      model: GEMINI_MODELS.copilot, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: CONTEXT_SYSTEM, temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json', thinkingConfig: NO_THINKING },
    })
    if (!r.text?.trim()) throw new Error('Gemini no devolvió el resumen')
    return r.text
  } }
}

export function geminiSearchStep(ai: GoogleGenAI, language = 'en'): Step<string, SearchOutcome> {
  return { name: 'Gemini + Google Search', run: async (query) => {
    const r = await ai.models.generateContent({
      model: GEMINI_MODELS.copilot, contents: [{ role: 'user', parts: [{ text: query }] }],
      config: { systemInstruction: searchSystem(language), tools: [{ googleSearch: {} }], temperature: 0.2, maxOutputTokens: 400, thinkingConfig: NO_THINKING },
    })
    const out = parseGeminiGrounding(r)
    if (!out.text) throw new Error('Gemini no devolvió texto con la búsqueda')
    return out
  } }
}

interface OpenRouterOpts { apiKey: string; model: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }

async function openRouterChat(o: OpenRouterOpts, body: Record<string, unknown>): Promise<OpenRouterLike> {
  const res = await (o.fetchImpl ?? fetch)('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json', ...o.headers },
    body: JSON.stringify({ model: o.model, ...body }),
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<OpenRouterLike>
}

export function openRouterRewriteStep(o: OpenRouterOpts): Step<string, string> {
  return { name: 'OpenRouter', run: async (prompt) => {
    const j = await openRouterChat(o, { temperature: 0, max_tokens: 200, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: REWRITE_SYSTEM }, { role: 'user', content: prompt }] })
    return j.choices?.[0]?.message?.content ?? ''
  } }
}

export function openRouterContextStep(o: OpenRouterOpts): Step<string, string> {
  return { name: 'OpenRouter', run: async (prompt) => {
    const j = await openRouterChat(o, { temperature: 0.2, max_tokens: 700, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: CONTEXT_SYSTEM }, { role: 'user', content: prompt }] })
    const text = j.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('OpenRouter no devolvió el resumen')
    return text
  } }
}

export function openRouterSearchStep(o: OpenRouterOpts, language = 'en'): Step<string, SearchOutcome> {
  return { name: 'OpenRouter + web', run: async (query) => {
    const j = await openRouterChat(o, { temperature: 0.2, max_tokens: 400, plugins: [{ id: 'web', max_results: 3 }],
      messages: [{ role: 'system', content: searchSystem(language) }, { role: 'user', content: query }] })
    const out = parseOpenRouterSearch(j)
    if (!out.text) throw new Error('OpenRouter no devolvió texto con la búsqueda')
    return out
  } }
}
