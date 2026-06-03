import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const CreateSchema = z.object({
  title: z.string().min(1).max(200).default('Grabación sin título'),
})

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const slug = generateSlug(parsed.data.title)
  const recording = await prisma.recording.create({
    data: { userId: session.user.id, title: parsed.data.title, slug, status: 'uploading' },
    select: { id: true, slug: true },
  })

  return NextResponse.json({ recording_id: recording.id, slug: recording.slug })
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const recordings = await prisma.recording.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, title: true, slug: true, status: true,
      durationSecs: true, fileSizeBytes: true, isPublic: true,
      viewCount: true, createdAt: true,
    },
  })

  // fileSizeBytes es BigInt en Prisma; JSON.stringify no lo serializa.
  return NextResponse.json({
    recordings: recordings.map(r => ({
      ...r,
      fileSizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null,
    })),
  })
}
