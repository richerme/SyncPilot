import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

type RouteParams = { params: Promise<{ id: string }> }

const TranscriptSchema = z.object({
  start_ms: z.number(),
  end_ms:   z.number(),
  text:     z.string().min(1),
  language: z.string().default('es'),
})

const PatchSchema = z.object({
  word_count: z.number().optional(),
  title:      z.string().optional(),
})

export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, userId: session.user.id },
  })
  if (!meeting) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const parsed = TranscriptSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  await prisma.transcript.create({
    data: {
      meetingId,
      startMs:  parsed.data.start_ms,
      endMs:    parsed.data.end_ms,
      text:     parsed.data.text,
      language: parsed.data.language,
    },
  })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, userId: session.user.id },
  })
  if (!meeting) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const parsed = PatchSchema.safeParse(body)

  const now = new Date()
  const durationSecs = Math.round((now.getTime() - meeting.startedAt.getTime()) / 1000)

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status:      'done',
      endedAt:     now,
      durationSecs,
      wordCount:   parsed.data?.word_count ?? meeting.wordCount,
      title:       parsed.data?.title ?? meeting.title,
    },
  })

  return NextResponse.json({ success: true })
}

export async function GET(_request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: meetingId } = await params

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, userId: session.user.id },
    include: {
      transcripts: { orderBy: { startMs: 'asc' } },
      suggestions: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!meeting) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  return NextResponse.json({ meeting })
}
