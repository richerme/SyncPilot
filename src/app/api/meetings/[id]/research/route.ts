import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getGenAI } from '@/lib/openrouter'
import { getMeetingContext } from '@/lib/meetingContext'
import { fullTranscript } from '@/lib/meetingTranscript'
import { meaningfulTitle } from '@/lib/meetingIdentity'
import { SAP_TERMS } from '@/features/live/copilot/profile'
import { SAP_ABAP_KNOWHOW } from '@/features/live/copilot/knowhow'
import { CopilotUnavailableError } from '@/lib/copilotAnswer'
import {
  runResearch, runContextSummary, runQuerySearch, blockedTermsFrom, NothingToSearchError,
  geminiRewriteStep, geminiSearchStep, geminiContextStep, openRouterRewriteStep, openRouterSearchStep, openRouterContextStep,
  type ResearchOutcome, type SearchOutcome, type Step,
} from '@/lib/copilotResearch'
import { z } from 'zod'

export const maxDuration = 60

// Tres usos del mismo botón (PRP-004 y PRP-005):
// - answer:  verificar una respuesta del Copiloto (pregunta + respuesta + lo último de la reunión).
// - context: «Investigar» libre, parte 1: de qué se habla ahora, en el idioma de la reunión (sin internet).
// - search:  «Investigar» libre, parte 2: busca la pregunta técnica de la parte 1 y contesta en ese idioma.
const Schema = z.discriminatedUnion('mode', [
  z.object({
    mode:     z.literal('answer'),
    question: z.string().max(2000).optional(),   // lo que preguntaron (vacío si fue el botón Responder)
    answer:   z.string().max(4000).default(''),  // la primera respuesta del Copiloto
    live:     z.string().max(20000).default(''), // lo que el navegador aún no guarda
  }),
  z.object({ mode: z.literal('context'), live: z.string().max(20000).default('') }),
  z.object({ mode: z.literal('search'), query: z.string().min(1).max(400), language: z.string().regex(/^[a-z]{2}$/).default('en') }),
])

// Vocabulario de SAP estándar: lo que aparece aquí se puede buscar; el resto de los términos de la
// reunión (nombres, empresa, siglas propias) se quita de la pregunta antes de salir a internet.
const STANDARD_VOCABULARY = `${SAP_ABAP_KNOWHOW}\n${SAP_TERMS.join('\n')}`
// ~3 minutos de reunión: «los últimos puntos» que pidió el usuario.
const CONTEXT_TAIL_CHARS = 6000

type RouteParams = { params: Promise<{ id: string }> }
type Meeting = { id: string; title: string | null; startedAt: Date }

function providers() {
  const ai = getGenAI()
  const key = process.env.OPENROUTER_API_KEY
  const or = key ? {
    apiKey: key,
    model: process.env.OPENROUTER_COPILOT_MODEL ?? 'google/gemini-2.5-flash',
    headers: { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000', 'X-Title': 'SyncPilot' },
  } : null
  return {
    available: !!ai || !!or,
    rewrite: [...(ai ? [geminiRewriteStep(ai)] : []), ...(or ? [openRouterRewriteStep(or)] : [])] as Step<string, string>[],
    context: [...(ai ? [geminiContextStep(ai)] : []), ...(or ? [openRouterContextStep(or)] : [])] as Step<string, string>[],
    search: (language = 'en') => [...(ai ? [geminiSearchStep(ai, language)] : []), ...(or ? [openRouterSearchStep(or, language)] : [])] as Step<string, SearchOutcome>[],
  }
}

async function blockedTerms(userId: string, meeting: Meeting): Promise<string[]> {
  const ctx = await getMeetingContext(userId, meeting.id)
  const title = meaningfulTitle(meeting.title)
  return blockedTermsFrom([...ctx.terms, ...(title ? [title] : [])], STANDARD_VOCABULARY)
}

/** Historial de la reunión (los términos de Google lo permiten para el usuario que lo pidió). */
async function remember(meeting: Meeting, text: string, context: string) {
  await prisma.meetingSuggestion.create({
    data: { meetingId: meeting.id, type: 'info', text, timestampMs: Math.max(0, Date.now() - meeting.startedAt.getTime()), context: context.slice(0, 500) },
  }).catch(() => {})
}

function searchResponse(r: ResearchOutcome) {
  if (r.failures.length) console.warn(`[meetings/research] respondió ${r.provider} (falló: ${r.failures.map(f => `${f.provider} ${f.kind}`).join(', ')})`)
  return NextResponse.json({
    query: r.query, text: r.text, sources: r.sources, searchQueries: r.searchQueries,
    suggestionsHtml: r.suggestionsHtml, provider: r.provider, ms: r.ms.rewrite + r.ms.search,
  })
}

// Solo con el botón. A internet sale únicamente la pregunta técnica reescrita y filtrada (lib/copilotResearch).
export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const userId = session.user.id

  const { id: meetingId } = await params
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId }, select: { id: true, title: true, startedAt: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const raw = await request.json().catch(() => ({})) as Record<string, unknown>
  const parsed = Schema.safeParse({ mode: 'answer', ...raw })
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const body = parsed.data

  const p = providers()
  if (!p.available) return NextResponse.json({ error: 'Falta GEMINI_API_KEY (y OPENROUTER_API_KEY de respaldo) en el servidor' }, { status: 500 })

  try {
    if (body.mode === 'context') {
      const [blocked, transcript] = await Promise.all([blockedTerms(userId, meeting), fullTranscript(meetingId, body.live)])
      if (!transcript.trim()) return NextResponse.json({ error: 'Todavía no hay conversación que investigar.' }, { status: 422 })
      const r = await runContextSummary(transcript.slice(-CONTEXT_TAIL_CHARS), blocked, p.context)
      if (r.failures.length) console.warn(`[meetings/research] contexto con ${r.provider} (falló: ${r.failures.map(f => `${f.provider} ${f.kind}`).join(', ')})`)
      if (!r.points.length) return NextResponse.json({ error: 'No se pudo resumir lo que se está hablando. Intenta de nuevo.' }, { status: 502 })
      await remember(meeting, r.points.map(x => `• ${x}`).join('\n'), 'Investigar: lo que se está hablando')
      return NextResponse.json({ language: r.language, points: r.points, query: r.query, provider: r.provider, ms: r.ms })
    }
    if (body.mode === 'search') {
      const r = await runQuerySearch(body.query, await blockedTerms(userId, meeting), p.search(body.language))
      await remember(meeting, r.text, `Investigar: ${r.query}`)
      return searchResponse(r)
    }
    const transcript = await fullTranscript(meetingId, body.live)
    const r = await runResearch({
      question: body.question?.trim() || null,
      firstAnswer: body.answer,
      transcriptTail: transcript.slice(-4000),
      blockedTerms: await blockedTerms(userId, meeting),
    }, { rewrite: p.rewrite, search: p.search() })
    await remember(meeting, r.text, `Investigar: ${r.query}`)
    return searchResponse(r)
  } catch (err) {
    if (err instanceof NothingToSearchError) return NextResponse.json({ error: err.message }, { status: 422 })
    if (err instanceof CopilotUnavailableError) {
      console.error('[meetings/research] sin proveedor:', err.failures.map(f => `${f.provider} ${f.kind}: ${f.detail}`).join(' | '))
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    throw err
  }
}
