import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

// Cuántos documentos de contexto tiene activos el usuario (para el aviso en IA en Vivo).
// El texto ya no viaja al navegador: el Copiloto lo busca en el servidor (lib/docContext).
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const count = await prisma.contextDocument.count({
    where: { userId: session.user.id, isActive: true, extractedText: { not: null } },
  })
  return NextResponse.json({ count })
}
