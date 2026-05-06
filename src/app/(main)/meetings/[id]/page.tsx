import { auth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'

type Params = { params: Promise<{ id: string }> }

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
function formatMs(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export default async function MeetingDetailPage({ params }: Params) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { id } = await params
  const meeting = await prisma.meeting.findFirst({
    where: { id, userId: session.user.id },
    include: {
      transcripts:  { orderBy: { startMs: 'asc' } },
      suggestions:  { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!meeting) notFound()

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/meetings" className="text-xs mb-2 block" style={{ color: '#818CF8' }}>← Reuniones</Link>
          <h1 className="text-display-xs font-bold text-white">{meeting.title ?? 'Reunión sin título'}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {new Date(meeting.startedAt).toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {meeting.durationSecs ? ` · ${formatDuration(meeting.durationSecs)}` : ''}
            {meeting.wordCount > 0 ? ` · ${meeting.wordCount.toLocaleString()} palabras` : ''}
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: meeting.status === 'done' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: meeting.status === 'done' ? '#10B981' : '#F59E0B' }}>
          {meeting.status === 'done' ? 'Finalizada' : 'En curso'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transcripción */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Transcripción ({meeting.transcripts.length} fragmentos)</h2>
          {meeting.transcripts.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>Sin transcripción</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {meeting.transcripts.map(t => (
                <div key={t.id} className="flex gap-2 text-sm">
                  <span className="text-xs flex-shrink-0 mt-0.5 font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    {formatMs(t.startMs)}
                  </span>
                  <p style={{ color: 'var(--color-text)' }}>{t.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sugerencias */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Sugerencias IA ({meeting.suggestions.length})</h2>
          {meeting.suggestions.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>Sin sugerencias</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {meeting.suggestions.map(s => (
                <div key={s.id} className={`suggestion-card type-${s.type}`}>
                  <p className="text-xs text-white">{s.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
