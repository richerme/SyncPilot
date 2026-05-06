import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'

type RouteParams = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('No autorizado', { status: 401 })

  const segments = (await params).path
  const storagePath = segments.join('/')

  // Verificar que el archivo pertenece al usuario (userId es el primer segmento)
  const fileUserId = segments[0]
  if (fileUserId !== session.user.id) {
    // Verificar si es una grabación pública
    const recordingId = segments[1]
    const recording = await prisma.recording.findFirst({
      where: { id: recordingId, isPublic: true },
    })
    if (!recording) return new NextResponse('Prohibido', { status: 403 })
  }

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  const filePath = path.join(uploadDir, storagePath)

  try {
    const stats = await stat(filePath)
    const buffer = await readFile(filePath)

    const range = request.headers.get('range')
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunkSize = end - start + 1

      return new NextResponse(buffer.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range':  `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type':   'video/webm',
        },
      })
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':   'video/webm',
        'Content-Length': String(stats.size),
        'Accept-Ranges':  'bytes',
        'Cache-Control':  'private, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('Archivo no encontrado', { status: 404 })
  }
}
