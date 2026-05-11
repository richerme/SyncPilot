import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { mkdir, appendFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

export const config = { api: { bodyParser: false } }
export const maxDuration = 300

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id: recordingId } = await params

  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, userId: session.user.id },
  })
  if (!recording) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const formData = await request.formData()
  const chunk = formData.get('chunk') as File | null
  const chunkIndex = Number(formData.get('chunkIndex'))
  const totalChunks = Number(formData.get('totalChunks'))

  if (!chunk) return NextResponse.json({ error: 'Sin chunk' }, { status: 400 })

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  const recordingDir = path.join(uploadDir, session.user.id, recordingId)
  await mkdir(recordingDir, { recursive: true })

  const fileName = 'recording.webm'
  const finalPath = path.join(recordingDir, fileName)
  const storagePath = path.join(session.user.id, recordingId, fileName).replace(/\\/g, '/')

  // En el primer chunk, eliminar archivo previo si existe (re-upload)
  if (chunkIndex === 0) {
    await unlink(finalPath).catch(() => {})
  }

  // Append directo al archivo final (los chunks llegan en orden desde el cliente)
  const buffer = Buffer.from(await chunk.arrayBuffer())
  await appendFile(finalPath, buffer)

  // Último chunk: marcar como listo
  if (chunkIndex === totalChunks - 1) {
    const { size } = await stat(finalPath)
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: 'ready',
        storagePath,
        fileSizeBytes: BigInt(size),
      },
    })
  }

  return NextResponse.json({ success: true, chunkIndex })
}
