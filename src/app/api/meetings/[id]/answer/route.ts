import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getGenAI } from '@/lib/openrouter'
import { GEMINI_MODELS, NO_THINKING } from '@/lib/geminiModels'
import { relevantDocContext } from '@/lib/docContext'
import { getMeetingContext, type MeetingContext } from '@/lib/meetingContext'
import { fullTranscript } from '@/lib/meetingTranscript'
import { copilotConversation, BUTTON_ASK, type EarlierAnswer } from '@/lib/meetingIdentity'
import { COPILOT_NAME } from '@/features/live/copilot/profile'
import { COPILOT_SYSTEM } from '@/features/live/copilot/knowhow'
import { openWithFallback, chatCompletionStream, CopilotUnavailableError, type CopilotProvider } from '@/lib/copilotAnswer'
import { z } from 'zod'

export const maxDuration = 60

const Schema = z.object({
  // Pregunta concreta (lo que dijeron al nombrarte, o lo que escribiste). Vacía = la última pregunta de la reunión.
  question: z.string().max(2000).optional(),
  // Lo que todavía no está guardado en la base de datos: últimos fragmentos y el turno en curso.
  live:     z.string().max(20000).default(''),
  trigger:  z.enum(['button', 'name', 'typed']).default('button'),
  // Idioma de la respuesta, elegido en IA en Vivo para esa reunión (PRP-005). Inglés por defecto.
  answerLang: z.enum(['en', 'es']).default('en'),
})

// Las instrucciones (en el caché) piden inglés; esta línea al final de la conversación lo cambia.
const SPANISH_ANSWER = `ANSWER LANGUAGE: write this answer in clear, natural, professional Spanish (Latin American), in first person as ${COPILOT_NAME}, with the same length and style rules. Keep standard SAP terms as they are (BAdI, IDoc, BAPI, CDS view, transport).`

const RELEVANT_DOCS_CHARS  = 400_000
const EARLIER_ANSWERS      = 3     // las últimas respuestas que ya viste, para no repetirlas
const EARLIER_ANSWER_CHARS = 700

/** Las últimas respuestas del Copiloto en esta reunión (las guarda esta misma ruta al terminar). */
async function earlierAnswers(meetingId: string): Promise<EarlierAnswer[]> {
  const rows = await prisma.meetingSuggestion.findMany({
    where: { meetingId, type: 'reply' },
    orderBy: { createdAt: 'desc' },
    take: EARLIER_ANSWERS,
    select: { timestampMs: true, text: true },
  }).catch(() => [])
  return rows.reverse().map(r => ({ atMs: r.timestampMs, text: r.text.slice(0, EARLIER_ANSWER_CHARS) }))
}

/** Documentos para el prompt cuando no hay caché (o el caché falló). */
async function docsForPrompt(ctx: MeetingContext, userId: string, query: string): Promise<string> {
  if (ctx.inlineDocs) return `REFERENCE DOCUMENTS (complete):\n${ctx.inlineDocs}`
  if (!ctx.docs.length) return 'REFERENCE DOCUMENTS: none uploaded.'
  const excerpts = await relevantDocContext(userId, query, RELEVANT_DOCS_CHARS)
  return excerpts ? `REFERENCE DOCUMENTS (most relevant excerpts):\n${excerpts}` : 'REFERENCE DOCUMENTS: none uploaded.'
}

type RouteParams = { params: Promise<{ id: string }> }

// Respuesta del Copiloto en inglés, en streaming (las primeras palabras aparecen en ~1 s).
// Solo se llama cuando hay que contestar: botón, tu nombre en la reunión o pregunta escrita.
export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const userId = session.user.id

  const { id: meetingId } = await params
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId }, select: { id: true, title: true, startedAt: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const { question, live, trigger, answerLang } = parsed.data

  const ai = getGenAI()
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!ai && !openRouterKey) return NextResponse.json({ error: 'Falta GEMINI_API_KEY (y OPENROUTER_API_KEY de respaldo) en el servidor' }, { status: 500 })

  // Documentos completos (caché de la reunión) + resumen + TODA la reunión + lo que ya contestó + la pregunta.
  const [ctx, transcript, earlier] = await Promise.all([
    getMeetingContext(userId, meetingId),
    fullTranscript(meetingId, live),
    earlierAnswers(meetingId),
  ])
  if (!question?.trim() && !transcript) return NextResponse.json({ error: 'Todavía no hay conversación' }, { status: 400 })
  const ask = question?.trim() ? question.trim() : BUTTON_ASK
  const baseConversation = copilotConversation({ meeting, brief: ctx.brief, transcript, trigger, ask, earlier })
  const conversation = answerLang === 'es' ? `${baseConversation}\n\n${SPANISH_ANSWER}` : baseConversation
  const base = { temperature: 0.3, maxOutputTokens: 500, thinkingConfig: NO_THINKING } // primera palabra en ~1 s

  // Proveedores en orden (10 nov 2026): Gemini (con caché si hay) y, si falla al abrir o en el primer
  // pedazo, OpenRouter. Antes solo había Gemini: con su saldo prepagado agotado (402) el Copiloto fallaba.
  const promptWithDocs = async () => `${await docsForPrompt(ctx, userId, `${ask}\n${transcript.slice(-3000)}`)}\n\n${conversation}`
  const providers: CopilotProvider[] = []
  if (ai) {
    const withoutCache = async () => ai.models.generateContentStream({
      model: GEMINI_MODELS.copilot,
      contents: [{ role: 'user', parts: [{ text: await promptWithDocs() }] }],
      config: { ...base, systemInstruction: COPILOT_SYSTEM },
    })
    // Con caché: instrucciones + know-how (y los documentos, si cupieron) ya van dentro.
    const cachedPrompt = async () => ctx.docsInCache || !ctx.docs.length ? conversation : promptWithDocs()
    providers.push({
      name: 'Gemini',
      open: async () => {
        let result: Awaited<ReturnType<typeof withoutCache>>
        if (ctx.cacheName) {
          try {
            result = await ai.models.generateContentStream({
              model: GEMINI_MODELS.copilot,
              contents: [{ role: 'user', parts: [{ text: await cachedPrompt() }] }],
              config: { ...base, cachedContent: ctx.cacheName },
            })
          } catch (err) {
            console.warn('[meetings/answer] caché no disponible:', err instanceof Error ? err.message.slice(0, 160) : err)
            result = await withoutCache()
          }
        } else {
          result = await withoutCache()
        }
        return (async function* () { for await (const chunk of result) yield chunk.text ?? '' })()
      },
    })
  }
  if (openRouterKey) {
    providers.push({
      name: 'OpenRouter',
      open: async () => chatCompletionStream({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: openRouterKey,
        model: process.env.OPENROUTER_COPILOT_MODEL ?? 'google/gemini-2.5-flash',
        system: COPILOT_SYSTEM, // sin caché: el know-how va en cada llamada (~10k tokens)
        user: await promptWithDocs(),
        temperature: base.temperature,
        maxTokens: base.maxOutputTokens,
        headers: { 'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000', 'X-Title': 'SyncPilot' },
      }),
    })
  }

  let opened: Awaited<ReturnType<typeof openWithFallback>>
  try {
    opened = await openWithFallback(providers)
  } catch (err) {
    if (err instanceof CopilotUnavailableError) {
      console.error('[meetings/answer] sin proveedor:', err.failures.map(f => `${f.provider} ${f.kind}: ${f.detail}`).join(' | '))
      return NextResponse.json({ error: err.message, kinds: err.failures.map(f => f.kind) }, { status: 503 })
    }
    throw err
  }
  if (opened.failures.length) {
    console.warn(`[meetings/answer] respondió ${opened.provider} (falló: ${opened.failures.map(f => `${f.provider} ${f.kind}`).join(', ')})`)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = opened.first
      if (full) controller.enqueue(encoder.encode(full))
      try {
        for (;;) {
          const r = await opened.rest.next()
          if (r.done) break
          const text = r.value
          if (!text) continue
          full += text
          controller.enqueue(encoder.encode(text))
        }
      } catch (err) {
        console.error('[meetings/answer] stream:', err instanceof Error ? err.message : err)
      } finally {
        controller.close()
      }
      if (full.trim()) {
        await prisma.meetingSuggestion.create({
          data: {
            meetingId,
            timestampMs: Math.max(0, Date.now() - meeting.startedAt.getTime()),
            type: 'reply',
            text: full.trim(),
            context: (question?.trim() || `(${trigger})`).slice(0, 500),
          },
        }).catch(() => {})
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // no-transform: que nada comprima/almacene en búfer la respuesta y llegue palabra por palabra.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
