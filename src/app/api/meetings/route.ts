import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const title = body.title ?? `Reunión ${new Date().toLocaleDateString('es')}`

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
