import { NextResponse } from 'next/server'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

// Diagnóstico de IA en Vivo (18 nov 2026): la transcripción y la traducción se congelaban a media
// reunión. Cada conexión, corte, reconexión, falta de audio y la memoria del navegador (cada 5 min)
// quedan en /uploads/diag/<reunión>.jsonl para saber qué pasó sin depender de lo que se vio en pantalla.

type RouteParams = { params: Promise<{ id: string }> }

const MAX_FILE_BYTES = 1_000_000

const DiagSchema = z.object({
  event: z.string().min(1).max(40).regex(/^[a-z-]+$/),
  at:    z.string().max(40),
  data:  z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).optional(),
})

function diagFile(meetingId: string) {
  const base = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  return path.join(base, 'diag', `${meetingId}.jsonl`)
}

async function ownMeeting(meetingId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  return prisma.meeting.findFirst({ where: { id: meetingId, userId: session.user.id }, select: { id: true } })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: meetingId } = await params
  if (!(await ownMeeting(meetingId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const parsed = DiagSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const line = JSON.stringify({ ...parsed.data, received: new Date().toISOString() })
  console.log(`[live-diag] ${meetingId} ${line}`)
  const file = diagFile(meetingId)
  try {
    const size = await stat(file).then(s => s.size).catch(() => 0)
    if (size < MAX_FILE_BYTES) {
      await mkdir(path.dirname(file), { recursive: true })
      await appendFile(file, `${line}\n`, 'utf8')
    }
  } catch (err) {
    console.error('[live-diag] no se pudo guardar', err instanceof Error ? err.message : String(err))
  }
  return NextResponse.json({ ok: true })
}

/** El registro de diagnóstico de una reunión (solo su dueño). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { id: meetingId } = await params
  if (!(await ownMeeting(meetingId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const text = await readFile(diagFile(meetingId), 'utf8').catch(() => '')
  const events = text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) as unknown } catch { return null } }).filter(Boolean)
  return NextResponse.json({ events })
}
