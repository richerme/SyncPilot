import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

type RouteParams = { params: Promise<{ path: string[] }> }

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('No autorizado', { status: 401 })

  const segments = (await params).path
  const storagePath = segments.join('/')

  const fileUserId = segments[0]
  if (fileUserId !== session.user.id) {
    const recordingId = segments[1]
    const recording = await prisma.recording.findFirst({
      where: { id: recordingId, isPublic: true },
    })
    if (!recording) return new NextResponse('Prohibido', { status: 403 })
  }

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  const filePath = path.join(uploadDir, storagePath)

  // Contencion anti path-traversal: la ruta resuelta debe quedar dentro de uploadDir.
  const root = path.resolve(uploadDir)
  if (path.resolve(filePath) !== root && !path.resolve(filePath).startsWith(root + path.sep)) {
    return new NextResponse('Prohibido', { status: 403 })
  }

  let stats
  try {
    stats = await stat(filePath)
  } catch {
    return new NextResponse('Archivo no encontrado', { status: 404 })
  }

  const range = request.headers.get('range')
  const fileSize = stats.size

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1)
    const chunkSize = end - start + 1

    const nodeStream = createReadStream(filePath, { start, end })
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type':   'video/webm',
        'Cache-Control':  'private, max-age=3600',
      },
    })
  }

  const nodeStream = createReadStream(filePath)
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream

  return new NextResponse(webStream, {
    headers: {
      'Content-Type':   'video/webm',
      'Content-Length': String(fileSize),
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'private, max-age=3600',
    },
  })
}
