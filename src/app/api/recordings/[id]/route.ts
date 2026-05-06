import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { unlink } from 'node:fs/promises'
import path from 'node:path'

const PatchSchema = z.object({
  status:       z.enum(['uploading', 'processing', 'ready', 'error']).optional(),
  storagePath:  z.string().optional(),
  fileSizeBytes: z.number().optional(),
  durationSecs: z.number().optional(),
  isPublic:     z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const recording = await prisma.recording.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!recording) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const updated = await prisma.recording.update({
    where: { id },
    data: {
      ...parsed.data,
      fileSizeBytes: parsed.data.fileSizeBytes ? BigInt(parsed.data.fileSizeBytes) : undefined,
    },
  })

  return NextResponse.json({ recording: { ...updated, fileSizeBytes: updated.fileSizeBytes?.toString() } })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const recording = await prisma.recording.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, storagePath: true },
  })
  if (!recording) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  if (recording.storagePath) {
    const uploadDir = process.env.UPLOAD_DIR ?? '/uploads'
    const filePath = path.join(uploadDir, recording.storagePath)
    await unlink(filePath).catch(() => {})
  }

  await prisma.recording.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
