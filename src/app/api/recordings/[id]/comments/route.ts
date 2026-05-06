import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const CommentSchema = z.object({
  text:        z.string().min(1).max(1000),
  timestampMs: z.number().int().min(0),
  guestName:   z.string().max(100).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  const { id: recordingId } = await params

  const body = await request.json().catch(() => ({}))
  const parsed = CommentSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const comment = await prisma.comment.create({
    data: {
      recordingId,
      userId:      session?.user?.id ?? null,
      guestName:   session?.user?.id ? null : (parsed.data.guestName ?? 'Anónimo'),
      text:        parsed.data.text,
      timestampMs: parsed.data.timestampMs,
    },
    include: { user: { select: { name: true } } },
  })

  return NextResponse.json({
    comment: {
      id: comment.id, timestampMs: comment.timestampMs, text: comment.text,
      guestName: comment.guestName, createdAt: comment.createdAt.toISOString(),
      authorName: comment.user?.name ?? comment.guestName,
    },
  })
}
