import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const docs = await prisma.contextDocument.findMany({
    where: { userId: session.user.id, isActive: true, extractedText: { not: null } },
    select: { name: true, extractedText: true },
    take: 5,
  })

  if (docs.length === 0) return NextResponse.json({ count: 0, context: '' })

  const context = docs
    .map(d => `[Documento: ${d.name}]\n${d.extractedText}`)
    .join('\n\n---\n\n')

  return NextResponse.json({ count: docs.length, context: context.slice(0, 10000) })
}
