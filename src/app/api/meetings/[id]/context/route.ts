import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getMeetingContext } from '@/lib/meetingContext'

export const maxDuration = 120

type RouteParams = { params: Promise<{ id: string }> }

// POST: arma el contexto de la reunión al iniciarla (documentos activos completos en caché,
// resumen de qué trata y términos para el reconocimiento de voz). Lo llama IA en Vivo justo
// después de crear la reunión, sin detener el inicio.
export async function POST(_request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const userId = session.user.id

  const { id: meetingId } = await params
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId }, select: { id: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  const ctx = await getMeetingContext(userId, meetingId)
  return NextResponse.json({
    docs: ctx.docs,
    brief: ctx.brief,
    terms: ctx.terms,
    cached: !!ctx.cacheName,
    tooLarge: ctx.tooLarge,
  })
}
