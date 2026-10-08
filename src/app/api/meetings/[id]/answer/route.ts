import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getGenAI } from '@/lib/openrouter'
import { GEMINI_MODELS, NO_THINKING } from '@/lib/geminiModels'
import { relevantDocContext } from '@/lib/docContext'
import { COPILOT_INSTRUCTIONS, COPILOT_NAME } from '@/features/live/copilot/profile'
import { z } from 'zod'

export const maxDuration = 60

const Schema = z.object({
  // Pregunta concreta (lo que dijeron al nombrarte, o lo que escribiste). Vacía = la última pregunta de la reunión.
  question:   z.string().max(2000).optional(),
  // Últimos minutos de la conversación, con "Rick:" / "Meeting:" por línea.
  transcript: z.string().max(8000).default(''),
  trigger:    z.enum(['button', 'name', 'typed']).default('button'),
})

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
  const { question, transcript, trigger } = parsed.data
  if (!question?.trim() && !transcript.trim()) return NextResponse.json({ error: 'Todavía no hay conversación' }, { status: 400 })

  const ai = getGenAI()
  if (!ai) return NextResponse.json({ error: 'Falta GEMINI_API_KEY en el servidor' }, { status: 500 })

  const docs = await relevantDocContext(userId, `${question ?? ''}\n${transcript.slice(-1500)}`)
  const ask = question?.trim()
    ? question.trim()
    : `The most recent question or request addressed to ${COPILOT_NAME} (or still waiting for his answer) in the transcript.`
  const prompt = [
    docs ? `REFERENCE DOCUMENTS (excerpts):\n${docs}` : 'REFERENCE DOCUMENTS: none uploaded.',
    `MEETING TRANSCRIPT (oldest first; "${COPILOT_NAME}:" is ${COPILOT_NAME}, "Meeting:" are the other participants):\n${transcript || '(empty)'}`,
    `${trigger === 'typed' ? `${COPILOT_NAME} wants help with` : 'QUESTION TO ANSWER'}: ${ask}`,
  ].join('\n\n')

  const result = await ai.models.generateContentStream({
    model: GEMINI_MODELS.copilot,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: COPILOT_INSTRUCTIONS,
      temperature: 0.3,
      maxOutputTokens: 500,
      thinkingConfig: NO_THINKING, // primera palabra en ~0.8 s (ver lib/geminiModels)
    },
  })

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
