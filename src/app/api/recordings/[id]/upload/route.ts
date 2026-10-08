import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { mkdir, appendFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { RAW_FILE, recordingDir } from '@/features/recording/services/storage'

export const maxDuration = 300

type RouteParams = { params: Promise<{ id: string }> }

// Recibe un pedazo del video MIENTRAS se graba. `offset` = bytes ya enviados antes
// de este pedazo: si el archivo ya mide más (un reintento de algo que sí llegó),
// se responde 409 con el tamaño actual y el cliente lo da por subido.
export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: recordingId } = await params
  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, userId: session.user.id },
    select: { id: true, status: true },
  })
  if (!recording) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (recording.status !== 'uploading') return NextResponse.json({ error: 'La grabación ya se cerró' }, { status: 409 })

  const formData = await request.formData()
  const chunk = formData.get('chunk')
  const offset = Number(formData.get('offset'))
  if (!(chunk instanceof Blob) || !chunk.size) return NextResponse.json({ error: 'Sin chunk' }, { status: 400 })
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: 'offset inválido' }, { status: 400 })

  const dir = recordingDir(session.user.id, recordingId)
  const rawPath = path.join(dir, RAW_FILE)
  await mkdir(dir, { recursive: true })

  // El primer pedazo reinicia el archivo (si alguien reintenta desde cero).
  if (offset === 0) await unlink(rawPath).catch(() => {})
  const size = await stat(rawPath).then(s => s.size).catch(() => 0)
  if (size !== offset) return NextResponse.json({ error: 'Pedazo fuera de orden', size }, { status: 409 })

  await appendFile(rawPath, Buffer.from(await chunk.arrayBuffer()))
  return NextResponse.json({ success: true, size: size + chunk.size })
}
