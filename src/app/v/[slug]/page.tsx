import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import VideoPlayerPage from './VideoPlayerPage'

type Params = { params: Promise<{ slug: string }> }

export default async function VideoPage({ params }: Params) {
  const { slug } = await params
  const session = await auth()

  const recording = await prisma.recording.findUnique({
    where: { slug },
    include: {
      user: { select: { name: true, image: true } },
      transcripts: { orderBy: { startMs: 'asc' } },
      chapters:    { orderBy: { orderIndex: 'asc' } },
      aiSummaries: { take: 1, orderBy: { createdAt: 'desc' } },
      actionItems: { orderBy: { createdAt: 'asc' } },
      comments:    { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, image: true } } } },
    },
  })

  if (!recording) notFound()

  // Control de acceso: privada → solo dueño
  if (!recording.isPublic && recording.userId !== session?.user?.id) notFound()

  // Incrementar vistas (fire-and-forget)
  prisma.recording.update({ where: { id: recording.id }, data: { viewCount: { increment: 1 } } }).catch(() => {})

  const uploadDir = process.env.UPLOAD_DIR ?? ''
  const videoUrl = recording.storagePath
    ? `/api/files/${recording.storagePath}`
    : null

  return (
    <VideoPlayerPage
      slug={slug}
      initialData={{
        recording: {
          id:          recording.id,
          title:       recording.title,
          description: recording.description,
          slug:        recording.slug,
          status:      recording.status,
          videoUrl,
          durationSecs: recording.durationSecs,
          isPublic:    recording.isPublic,
          isOwner:     session?.user?.id === recording.userId,
          viewCount:   recording.viewCount,
          createdAt:   recording.createdAt.toISOString(),
          authorName:  recording.user.name,
        },
        transcripts: recording.transcripts.map(t => ({
          id: t.id, startMs: t.startMs, endMs: t.endMs, speaker: t.speaker, text: t.text,
        })),
        chapters: recording.chapters.map(c => ({
          id: c.id, title: c.title, startMs: c.startMs, endMs: c.endMs,
          summary: c.summary, orderIndex: c.orderIndex,
        })),
        aiSummary: recording.aiSummaries[0]
          ? {
              summaryText: recording.aiSummaries[0].summaryText,
              keyPoints:   recording.aiSummaries[0].keyPoints,
              sentiment:   recording.aiSummaries[0].sentiment,
            }
          : null,
        actionItems: recording.actionItems.map(a => ({
          id: a.id, text: a.text, assignee: a.assignee,
          dueDateText: a.dueDateText, isCompleted: a.isCompleted,
        })),
        comments: recording.comments.map(c => ({
          id: c.id, timestampMs: c.timestampMs, text: c.text,
          guestName: c.guestName, createdAt: c.createdAt.toISOString(),
          authorName: c.user?.name ?? c.guestName,
        })),
      }}
    />
  )
}
