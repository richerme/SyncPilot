'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Meeting {
  id: string
  title: string | null
  status: string
  startedAt: string
  endedAt: string | null
  durationSecs: number | null
  wordCount: number
}

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function MeetingsList({ meetings }: { meetings: Meeting[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/meetings/${pending.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'No se pudo eliminar la reunión')
      }
      setPending(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="space-y-2">
        {meetings.map(m => (
          <div key={m.id} className="card p-4 flex items-center gap-4 hover:scale-[1.005] transition-transform">
            <Link href={`/meetings/${m.id}`}
              className="flex items-center gap-4 flex-1 min-w-0 no-underline">
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

            <button
              onClick={() => setPending(m)}
              aria-label="Eliminar reunión"
              title="Eliminar reunión"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#F87171' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      )}

      <ConfirmDialog
        open={!!pending}
        title="¿Eliminar reunión?"
        description={pending ? `Se eliminará "${pending.title ?? 'Reunión sin título'}" junto con su transcripción y sugerencias. Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  )
}
