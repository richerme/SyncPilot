import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { chatCompletion } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  transcript_segment: z.string().min(1).max(5000),
  context_before:     z.string().max(2000).optional(),
  document_context:   z.string().max(3000).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, userId: session.user.id },
    select: { id: true, status: true, startedAt: true },
  })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const { transcript_segment, context_before, document_context } = parsed.data

  const prompt = `Eres un asistente invisible en una reunión de trabajo. Analiza lo que se está hablando y proporciona sugerencias útiles y concisas.
REGLA: El idioma de tus sugerencias debe coincidir con el idioma del transcript.
Responde SOLO con un JSON array:
[{ "type": "reply|question|info|warning", "text": "sugerencia aquí" }]
- "reply": Respuesta o comentario que el usuario podría decir
- "question": Pregunta útil para aclarar algo
- "info": Información relevante basándote en los documentos de referencia
- "warning": Algo importante a tener en cuenta
Máximo 3 sugerencias. Sé directo y útil.

${context_before ? `CONTEXTO PREVIO:\n${context_before}\n\n` : ''}${document_context ? `DOCUMENTOS DE REFERENCIA:\n${document_context}\n\n` : ''}TRANSCRIPCIÓN ACTUAL:
${transcript_segment}`

  let suggestions: Array<{ type: string; text: string }> = []
  try {
    const raw = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: 0.7, maxTokens: 512, jsonMode: true }
    )
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) suggestions = JSON.parse(match[0])
  } catch {
    suggestions = [{ type: 'info', text: 'No se pudieron generar sugerencias en este momento.' }]
  }

  const validTypes = ['reply', 'question', 'info', 'warning']
  const relativeMs = Math.max(0, Date.now() - new Date(meeting.startedAt).getTime())

  const toInsert = suggestions.slice(0, 3).map(s => ({
    meetingId,
    timestampMs: relativeMs,
    type: (validTypes.includes(s.type) ? s.type : 'info') as 'reply' | 'question' | 'info' | 'warning',
    text: s.text,
  }))

  if (toInsert.length > 0) {
    await prisma.meetingSuggestion.createMany({ data: toInsert })
  }

  return NextResponse.json({ suggestions })
}
