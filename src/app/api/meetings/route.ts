import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const CreateSchema = z.object({ title: z.string().trim().max(120).optional() })

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const title = parsed.data.title || `Reunión ${new Date().toLocaleDateString('es')}`

  const meeting = await prisma.meeting.create({
    data: { userId: session.user.id, title, status: 'active' },
    select: { id: true, title: true, startedAt: true },
  })

  return NextResponse.json({ meeting_id: meeting.id, ...meeting })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const meetings = await prisma.meeting.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true, title: true, status: true, startedAt: true,
      endedAt: true, durationSecs: true, wordCount: true,
    },
  })

  return NextResponse.json({ meetings })
}
