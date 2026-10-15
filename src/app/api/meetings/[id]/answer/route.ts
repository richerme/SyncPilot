import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getGenAI } from '@/lib/openrouter'
import { GEMINI_MODELS, NO_THINKING } from '@/lib/geminiModels'
import { relevantDocContext } from '@/lib/docContext'
import { getMeetingContext, type MeetingContext } from '@/lib/meetingContext'
import { COPILOT_INSTRUCTIONS, COPILOT_NAME } from '@/features/live/copilot/profile'
import { z } from 'zod'

export const maxDuration = 60

const Schema = z.object({
  // Pregunta concreta (lo que dijeron al nombrarte, o lo que escribiste). Vacía = la última pregunta de la reunión.
  question: z.string().max(2000).optional(),
  // Lo que todavía no está guardado en la base de datos: últimos fragmentos y el turno en curso.
  live:     z.string().max(20000).default(''),
  trigger:  z.enum(['button', 'name', 'typed']).default('button'),
})

// Toda la reunión (PRP-003): 1-2 h son ~40k tokens; el tope solo protege de lo absurdo.
const MAX_TRANSCRIPT_CHARS = 400_000
const RELEVANT_DOCS_CHARS  = 400_000

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

/** La reunión completa desde la base de datos + lo que el navegador aún no guarda. */
async function fullTranscript(meetingId: string, live: string): Promise<string> {
  const rows = await prisma.transcript.findMany({
    where: { meetingId }, orderBy: { startMs: 'asc' }, select: { startMs: true, speaker: true, text: true },
  })
  const saved = rows.map(r => `[${mmss(r.startMs)}] ${r.speaker === 'me' ? COPILOT_NAME : 'Meeting'}: ${r.text}`).join('\n')
  return `${saved}\n${live}`.trim().slice(-MAX_TRANSCRIPT_CHARS)
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
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId }, select: { id: true, startedAt: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const { question, live, trigger } = parsed.data

  const ai = getGenAI()
  if (!ai) return NextResponse.json({ error: 'Falta GEMINI_API_KEY en el servidor' }, { status: 500 })

  // Documentos completos (caché de la reunión) + resumen + TODA la reunión + la pregunta.
  const [ctx, transcript] = await Promise.all([getMeetingContext(userId, meetingId), fullTranscript(meetingId, live)])
  if (!question?.trim() && !transcript) return NextResponse.json({ error: 'Todavía no hay conversación' }, { status: 400 })
  const ask = question?.trim()
    ? question.trim()
    : `The most recent question or request addressed to ${COPILOT_NAME} (or still waiting for his answer) in the transcript.`
  const conversation = [
    ctx.brief ? `MEETING CONTEXT (prepared from the documents, in Spanish):\n${ctx.brief}` : '',
    `MEETING TRANSCRIPT (whole meeting so far, oldest first, [mm:ss] from the start; "${COPILOT_NAME}:" is ${COPILOT_NAME}, "Meeting:" are the other participants):\n${transcript || '(empty)'}`,
    `${trigger === 'typed' ? `${COPILOT_NAME} wants help with` : 'QUESTION TO ANSWER'}: ${ask}`,
  ].filter(Boolean).join('\n\n')
  const base = { temperature: 0.3, maxOutputTokens: 500, thinkingConfig: NO_THINKING } // primera palabra en ~1 s

  const withoutCache = async () => ai.models.generateContentStream({
    model: GEMINI_MODELS.copilot,
    contents: [{ role: 'user', parts: [{ text: `${await docsForPrompt(ctx, userId, `${ask}\n${transcript.slice(-3000)}`)}\n\n${conversation}` }] }],
    config: { ...base, systemInstruction: COPILOT_INSTRUCTIONS },
  })
  let result: Awaited<ReturnType<typeof withoutCache>>
  if (ctx.cacheName) {
    try {
      // El caché ya trae las instrucciones del Copiloto y los documentos completos.
      result = await ai.models.generateContentStream({
        model: GEMINI_MODELS.copilot,
        contents: [{ role: 'user', parts: [{ text: conversation }] }],
        config: { ...base, cachedContent: ctx.cacheName },
      })
    } catch (err) {
      console.warn('[meetings/answer] caché no disponible:', err instanceof Error ? err.message.slice(0, 160) : err)
      result = await withoutCache()
    }
  } else {
    result = await withoutCache()
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      try {
        for await (const chunk of result) {
          const text = chunk.text ?? ''
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
