import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default async function MeetingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const meetings = await prisma.meeting.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    select: { id: true, title: true, status: true, startedAt: true, endedAt: true, durationSecs: true, wordCount: true },
  })

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display-xs font-bold text-white">Reuniones con IA</h1>
          <p className="text-body-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {meetings.length} sesión{meetings.length !== 1 ? 'es' : ''} registrada{meetings.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/live" className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Nueva sesión
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">🧠</div>
          <h2 className="text-lg font-semibold text-white mb-2">Sin reuniones aún</h2>
          <p className="text-sm max-w-xs mb-6" style={{ color: 'var(--color-text-secondary)' }}>
            Inicia el copiloto de IA en tu próxima reunión y toda la transcripción quedará aquí.
          </p>
          <Link href="/live" className="btn-primary text-sm px-6 py-2.5">Iniciar sesión de IA</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map(m => (
            <Link key={m.id} href={`/meetings/${m.id}`}
              className="card p-4 flex items-center gap-4 hover:scale-[1.005] transition-transform no-underline block">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                style={{ background: 'rgb(99 102 241 / 0.15)' }}>
                🧠
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{m.title ?? 'Reunión sin título'}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {new Date(m.startedAt).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {m.durationSecs ? ` · ${formatDuration(m.durationSecs)}` : ''}
                  {m.wordCount > 0 ? ` · ${m.wordCount.toLocaleString()} palabras` : ''}
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: m.status === 'done' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)', color: m.status === 'done' ? '#10B981' : '#F59E0B' }}>
                {m.status === 'done' ? 'Finalizada' : 'En curso'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
