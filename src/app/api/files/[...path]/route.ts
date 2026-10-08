import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import type { NextRequest } from 'next/server'

type RouteParams = { params: Promise<{ path: string[] }> }

export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm' }

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" → [start, end] dentro del archivo, o null si no se puede servir. */
function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  let start: number
  let end: number
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2])) // sufijo: los últimos n bytes
    end = size - 1
  } else {
    start = Number(m[1])
    // Rango abierto: hasta el final. El navegador corta la conexión cuando ya tiene
    // suficiente (antes se servía de 1 MB en 1 MB: muchos viajes antes de reproducir).
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start <= end && start < size ? [start, end] : null
}

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

  const fileSize = stats.size
  const headers: Record<string, string> = {
    'Content-Type':  CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Last-Modified': stats.mtime.toUTCString(),
  }

  const range = request.headers.get('range')
  if (range) {
    const r = parseRange(range, fileSize)
    if (!r) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } })
    const [start, end] = r
    const webStream = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
    return new NextResponse(webStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Content-Length': String(end - start + 1) },
    })
  }

  const webStream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
  return new NextResponse(webStream, { headers: { ...headers, 'Content-Length': String(fileSize) } })
}
