import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import RecordingsClient from './RecordingsClient'

export default async function RecordingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

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

  const serialized = recordings.map(r => ({
    ...r,
    fileSizeBytes: r.fileSizeBytes ? Number(r.fileSizeBytes) : null,
    createdAt: r.createdAt.toISOString(),
  }))

  return <RecordingsClient initialRecordings={serialized} />
}
