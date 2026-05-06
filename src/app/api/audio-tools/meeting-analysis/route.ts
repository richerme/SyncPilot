import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { chatCompletion } from '@/lib/openrouter'
import { z } from 'zod'
import type { NextRequest } from 'next/server'

export const maxDuration = 120

const PostSchema = z.object({ meeting_id: z.string() })

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const meetingId = request.nextUrl.searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId requerido' }, { status: 400 })

  const saved = await prisma.aiSummary.findFirst({
    where: { meetingId, recording: null },
    orderBy: { createdAt: 'desc' },
  })

  if (!saved) return NextResponse.json(null)

  try {
    const analysis = JSON.parse(saved.summaryText)
    return NextResponse.json(analysis)
  } catch {
    return NextResponse.json(null)
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'meeting_id requerido' }, { status: 400 })

  const { meeting_id } = parsed.data

  const meeting = await prisma.meeting.findFirst({
    where: { id: meeting_id, userId: session.user.id },
    include: { transcripts: { orderBy: { startMs: 'asc' } } },
  })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })
  if (meeting.transcripts.length === 0) return NextResponse.json({ error: 'Esta reunión no tiene transcripción' }, { status: 422 })

  const fullTranscript = meeting.transcripts.map(t => t.text).join('\n')
  const durationSecs   = meeting.durationSecs ?? meeting.transcripts.length * 3

  const prompt = `Analyze this meeting transcript and provide a comprehensive structured analysis.
Return ONLY a valid JSON object with this exact structure:
{
  "executiveSummary": "resumen ejecutivo en 3-5 oraciones",
  "decisions": ["decisión 1", "decisión 2"],
  "nextSteps": ["paso 1", "paso 2", "paso 3"],
  "participants": ["participante detectado 1", "participante 2"],
  "tensionPoints": ["punto de tensión o desacuerdo detectado"],
  "sentiment": "positive|neutral|negative",
  "sentimentScore": número 0-100,
  "keyTopics": ["tema 1", "tema 2", "tema 3"],
  "duration": "${Math.round(durationSecs / 60)} minutos"
}

Respond in the same language as the transcript.

TRANSCRIPT:
${fullTranscript.slice(0, 6000)}`

  let analysis
  try {
    const raw = await chatCompletion([{ role: 'user', content: prompt }], {
      temperature: 0.4, maxTokens: 1500, jsonMode: true,
    })
    const match = raw.match(/\{[\s\S]*\}/)
    analysis = JSON.parse(match ? match[0] : raw)
  } catch {
    return NextResponse.json({ error: 'Error al generar análisis' }, { status: 500 })
  }

  // Guardar en AiSummary para no re-generar
  await prisma.aiSummary.upsert({
    where: { id: `pro-${meeting_id}` },
    create: {
      id:           `pro-${meeting_id}`,
      meetingId:    meeting_id,
      summaryText:  JSON.stringify(analysis),
      keyPoints:    analysis.keyTopics ?? [],
      sentiment:    ['positive','neutral','negative'].includes(analysis.sentiment) ? analysis.sentiment : 'neutral',
      modelVersion: 'meeting-assistant-pro',
    },
    update: {
      summaryText:  JSON.stringify(analysis),
      keyPoints:    analysis.keyTopics ?? [],
      sentiment:    ['positive','neutral','negative'].includes(analysis.sentiment) ? analysis.sentiment : 'neutral',
    },
  })

  return NextResponse.json(analysis)
}
