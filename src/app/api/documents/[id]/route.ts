import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { unlink } from 'node:fs/promises'
import path from 'node:path'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const doc = await prisma.contextDocument.findFirst({ where: { id, userId: session.user.id } })
  if (!doc) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  await prisma.contextDocument.update({ where: { id }, data: { isActive: body.isActive } })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  const doc = await prisma.contextDocument.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, storagePath: true },
  })
  if (!doc) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
  await unlink(path.join(uploadDir, doc.storagePath)).catch(() => {})

  await prisma.contextDocument.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
