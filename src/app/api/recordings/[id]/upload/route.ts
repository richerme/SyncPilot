import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { writeFile, mkdir, appendFile, rename, readdir, unlink, readFile } from 'node:fs/promises'
import path from 'node:path'

export const config = { api: { bodyParser: false } }

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
  const mimeType = (formData.get('mimeType') as string) || 'video/webm'

  if (!chunk) return NextResponse.json({ error: 'Sin chunk' }, { status: 400 })

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  const recordingDir = path.join(uploadDir, session.user.id, recordingId)
  await mkdir(recordingDir, { recursive: true })

  const chunkPath = path.join(recordingDir, `chunk-${chunkIndex}`)
  const buffer = Buffer.from(await chunk.arrayBuffer())
  await writeFile(chunkPath, buffer)

  // Si es el último chunk, ensamblar el archivo final
  if (chunkIndex === totalChunks - 1) {
    const fileName = 'recording.webm'
    const finalPath = path.join(recordingDir, fileName)
    const storagePath = path.join(session.user.id, recordingId, fileName)

    // Concatenar todos los chunks en orden
    const finalFile = await import('node:fs').then(m => m.createWriteStream(finalPath))

    for (let i = 0; i < totalChunks; i++) {
      const cp = path.join(recordingDir, `chunk-${i}`)
      const data = await readFile(cp)
      await new Promise<void>((resolve, reject) => {
        finalFile.write(data, err => err ? reject(err) : resolve())
      })
    }
    await new Promise<void>(resolve => finalFile.end(resolve))

    // Eliminar chunks temporales
    for (let i = 0; i < totalChunks; i++) {
      await unlink(path.join(recordingDir, `chunk-${i}`)).catch(() => {})
    }

    // Obtener tamaño del archivo
    const { size } = await import('node:fs').then(m =>
      new Promise<{ size: number }>((resolve, reject) =>
        m.stat(finalPath, (err, s) => err ? reject(err) : resolve(s))
      )
    )

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
