import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { RAW_FILE, recordingDir, storagePathFor } from '@/features/recording/services/storage'
import { remuxRecording } from '@/features/recording/services/remux'

export const maxDuration = 300

const Schema = z.object({ durationSecs: z.number().int().min(0).max(24 * 3600).optional() })

type RouteParams = { params: Promise<{ id: string }> }

// Cierra la grabación: re-empaqueta el video subido por pedazos para que tenga
// duración e índice (reproducción y saltos inmediatos) y la marca como lista.
export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const userId = session.user.id

  const { id: recordingId } = await params
  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, userId },
    select: { id: true, status: true, storagePath: true },
  })
  if (!recording) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const dir = recordingDir(userId, recordingId)
  const raw = path.join(dir, RAW_FILE)
  const rawSize = await stat(raw).then(s => s.size).catch(() => 0)
  if (!rawSize) {
    // Ya se cerró antes (doble clic o reintento): no es error.
    if (recording.status === 'ready' && recording.storagePath) return NextResponse.json({ success: true })
    return NextResponse.json({ error: 'No llegó el video' }, { status: 409 })
  }

  let file: string
  let size: number
  let durationSecs = parsed.data.durationSecs ?? null
  try {
    const out = await remuxRecording(dir, raw)
    file = out.file
    size = out.size
    durationSecs = out.durationSecs ?? durationSecs
  } catch (err) {
    // Sin re-empaquetar se puede ver igual (como antes, más lento al iniciar).
    console.error('[recordings/complete] remux falló:', err instanceof Error ? err.message : err)
    file = 'recording.webm'
    await rename(raw, path.join(dir, file))
    size = rawSize
  }

  await prisma.recording.update({
    where: { id: recordingId },
    data: { status: 'ready', storagePath: storagePathFor(userId, recordingId, file), fileSizeBytes: BigInt(size), durationSecs },
  })
  return NextResponse.json({ success: true })
}
