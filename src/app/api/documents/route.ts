import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DOCUMENT_TYPES, extractDocumentText, uploadDir as getUploadDir, type DocumentExt } from '@/lib/documentText'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const documents = await prisma.contextDocument.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, fileType: true, isActive: true, createdAt: true, fileSizeBytes: true },
  })

  return NextResponse.json({
    documents: documents.map(d => ({ ...d, fileSizeBytes: d.fileSizeBytes ? Number(d.fileSizeBytes) : null })),
  })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Sin archivo' }, { status: 400 })

  const ext = (file.name.split('.').pop()?.toLowerCase() ?? 'txt') as DocumentExt
  if (!DOCUMENT_TYPES.includes(ext)) return NextResponse.json({ error: 'Tipo de archivo no soportado' }, { status: 400 })

  const uploadDir = getUploadDir()
  const docDir = path.join(uploadDir, session.user.id, 'documents')
  await mkdir(docDir, { recursive: true })

  const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const filePath = path.join(docDir, fileName)
  const storagePath = path.join(session.user.id, 'documents', fileName)

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  // Texto completo para el contexto de las reuniones (lib/documentText).
  const extractedText = await extractDocumentText(ext, buffer)

  const doc = await prisma.contextDocument.create({
    data: {
      userId:      session.user.id,
      name:        file.name,
      fileType:    ext,
      storagePath,
      fileSizeBytes: BigInt(buffer.length),
      extractedText,
    },
  })

  return NextResponse.json({ document: { ...doc, fileSizeBytes: Number(doc.fileSizeBytes) } }, { status: 201 })
}
