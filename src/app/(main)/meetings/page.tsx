import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import MeetingsList from './MeetingsList'

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
        <MeetingsList
          meetings={meetings.map(m => ({
            id: m.id,
            title: m.title,
            status: m.status,
            startedAt: m.startedAt.toISOString(),
            endedAt: m.endedAt ? m.endedAt.toISOString() : null,
            durationSecs: m.durationSecs,
            wordCount: m.wordCount,
          }))}
        />
      )}
    </div>
  )
}
