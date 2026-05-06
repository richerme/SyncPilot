import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [recordingsCount, meetingsCount, readyCount] = await Promise.all([
    prisma.recording.count({ where: { userId: session.user.id } }),
    prisma.meeting.count({ where: { userId: session.user.id } }),
    prisma.recording.count({ where: { userId: session.user.id, status: 'ready' } }),
  ])

  const recentRecordings = await prisma.recording.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 4,
    select: { id: true, title: true, slug: true, status: true, createdAt: true, durationSecs: true },
  })

  const recentMeetings = await prisma.meeting.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: 'desc' },
    take: 4,
    select: { id: true, title: true, status: true, startedAt: true, wordCount: true },
  })

  const STATS = [
    { label: 'Grabaciones',     value: recordingsCount, icon: '🎬', href: '/recordings', color: '#6366F1' },
    { label: 'Reuniones IA',    value: meetingsCount,   icon: '🧠', href: '/meetings',   color: '#06B6D4' },
    { label: 'Procesadas IA',   value: readyCount,      icon: '✅', href: '/recordings', color: '#10B981' },
  ]

  return (
    <div className="p-8 space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-display-xs font-bold text-white">
          Bienvenido, {session.user.name?.split(' ')[0] ?? 'Usuario'} 👋
        </h1>
        <p className="text-body-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Aquí tienes un resumen de tu actividad
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STATS.map(s => (
          <Link key={s.label} href={s.href}
            className="card p-5 flex items-center gap-4 hover:scale-[1.02] transition-transform no-underline">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: `${s.color}20` }}>
              {s.icon}
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/record" className="btn-record flex items-center gap-2 px-5 py-2.5">
          <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="white" />
          </svg>
          Nueva grabación
        </Link>
        <Link href="/live" className="btn-primary flex items-center gap-2 px-5 py-2.5">
          <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          IA en Vivo
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Recordings */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Grabaciones recientes</h2>
            <Link href="/recordings" className="text-xs" style={{ color: '#818CF8' }}>Ver todas →</Link>
          </div>
          {recentRecordings.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
              Sin grabaciones aún
            </p>
          ) : (
            <div className="space-y-2">
              {recentRecordings.map(r => (
                <Link key={r.id} href={r.status === 'ready' ? `/v/${r.slug}` : '/recordings'}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors no-underline">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(99,102,241,0.15)' }}>
                    <svg width="12" height="12" fill="#6366F1" viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.title}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(r.createdAt).toLocaleDateString('es')}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: r.status === 'ready' ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
                      color: r.status === 'ready' ? '#10B981' : '#818CF8',
                    }}>
                    {r.status === 'ready' ? 'Listo' : r.status === 'processing' ? 'Procesando' : r.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Meetings */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Reuniones recientes</h2>
            <Link href="/meetings" className="text-xs" style={{ color: '#818CF8' }}>Ver todas →</Link>
          </div>
          {recentMeetings.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
              Sin reuniones aún
            </p>
          ) : (
            <div className="space-y-2">
              {recentMeetings.map(m => (
                <Link key={m.id} href={`/meetings/${m.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors no-underline">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(6,182,212,0.15)' }}>
                    <span className="text-sm">🧠</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{m.title ?? 'Reunión sin título'}</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {m.wordCount > 0 ? `${m.wordCount.toLocaleString()} palabras · ` : ''}
                      {new Date(m.startedAt).toLocaleDateString('es')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
