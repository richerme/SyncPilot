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
  runResearch, blockedTermsFrom, NothingToSearchError, geminiRewriteStep, geminiSearchStep,
  openRouterRewriteStep, openRouterSearchStep, type SearchOutcome, type Step,
} from '@/lib/copilotResearch'
import { z } from 'zod'

export const maxDuration = 60

const Schema = z.object({
  question: z.string().max(2000).optional(),   // lo que preguntaron (vacío si fue el botón Responder)
  answer:   z.string().max(4000).default(''),  // la primera respuesta del Copiloto
  live:     z.string().max(20000).default(''), // lo que el navegador aún no guarda
})

// Vocabulario de SAP estándar: lo que aparece aquí se puede buscar; el resto de los términos de la
// reunión (nombres, empresa, siglas propias) se quita de la pregunta antes de salir a internet.
const STANDARD_VOCABULARY = `${SAP_ABAP_KNOWHOW}\n${SAP_TERMS.join('\n')}`

type RouteParams = { params: Promise<{ id: string }> }

// «Investigar» (PRP-004, fase 2): segunda tarjeta «Verificado en internet» con 1-3 fuentes.
// Solo con el botón. A internet sale únicamente la pregunta técnica reescrita (lib/copilotResearch).
export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const userId = session.user.id

  const { id: meetingId } = await params
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId }, select: { id: true, title: true, startedAt: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const { question, answer, live } = parsed.data

  const ai = getGenAI()
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!ai && !openRouterKey) return NextResponse.json({ error: 'Falta GEMINI_API_KEY (y OPENROUTER_API_KEY de respaldo) en el servidor' }, { status: 500 })

  const [ctx, transcript] = await Promise.all([getMeetingContext(userId, meetingId), fullTranscript(meetingId, live)])
  const or = openRouterKey ? {
    apiKey: openRouterKey,
    model: process.env.OPENROUTER_COPILOT_MODEL ?? 'google/gemini-2.5-flash',
    headers: { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000', 'X-Title': 'SyncPilot' },
  } : null
  const rewrite: Step<string, string>[] = [...(ai ? [geminiRewriteStep(ai)] : []), ...(or ? [openRouterRewriteStep(or)] : [])]
  const search: Step<string, SearchOutcome>[] = [...(ai ? [geminiSearchStep(ai)] : []), ...(or ? [openRouterSearchStep(or)] : [])]

  try {
    const r = await runResearch({
      question: question?.trim() || null,
      firstAnswer: answer,
      transcriptTail: transcript.slice(-4000),
      blockedTerms: blockedTermsFrom([...ctx.terms, ...(meaningfulTitle(meeting.title) ? [meaningfulTitle(meeting.title) as string] : [])], STANDARD_VOCABULARY),
    }, { rewrite, search })
    if (r.failures.length) console.warn(`[meetings/research] respondió ${r.provider} (falló: ${r.failures.map(f => `${f.provider} ${f.kind}`).join(', ')})`)
    // Historial de la reunión (los términos de Google lo permiten para el usuario que lo pidió).
    await prisma.meetingSuggestion.create({
      data: {
        meetingId, type: 'info', text: r.text,
        timestampMs: Math.max(0, Date.now() - meeting.startedAt.getTime()),
        context: `Investigar: ${r.query}`.slice(0, 500),
      },
    }).catch(() => {})
    return NextResponse.json({
      query: r.query, text: r.text, sources: r.sources, searchQueries: r.searchQueries,
      suggestionsHtml: r.suggestionsHtml, provider: r.provider, ms: r.ms.rewrite + r.ms.search,
    })
  } catch (err) {
    if (err instanceof NothingToSearchError) return NextResponse.json({ error: err.message }, { status: 422 })
    if (err instanceof CopilotUnavailableError) {
      console.error('[meetings/research] sin proveedor:', err.failures.map(f => `${f.provider} ${f.kind}: ${f.detail}`).join(' | '))
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    throw err
  }
}
