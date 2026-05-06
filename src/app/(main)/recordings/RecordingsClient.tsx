'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'

interface Recording {
  id: string; title: string; slug: string
  status: 'uploading' | 'processing' | 'ready' | 'error'
  durationSecs: number | null; fileSizeBytes: number | null
  isPublic: boolean; viewCount: number; createdAt: string
}

function formatDuration(secs: number) {
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`
}
function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ST = {
  ready:      { label: 'Listo',      color: '#10B981', bg: 'rgb(16 185 129/0.1)' },
  processing: { label: 'Procesando', color: '#F59E0B', bg: 'rgb(245 158 11/0.1)' },
  uploading:  { label: 'Subiendo',   color: '#6366F1', bg: 'rgb(99 102 241/0.1)' },
  error:      { label: 'Error',      color: '#EF4444', bg: 'rgb(239 68 68/0.1)' },
} as const

function RecordingCard({ rec, onProcess, onDelete, onTogglePublic }: {
  rec: Recording
  onProcess: (id: string) => Promise<void>
  onDelete:  (id: string) => Promise<void>
  onTogglePublic: (id: string, current: boolean) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const st = ST[rec.status] ?? ST.error

  const wrap = async (fn: () => Promise<void>) => { setLoading(true); await fn(); setLoading(false) }

  return (
    <div className="card group transition-all hover:border-indigo-500/40">
      {/* Thumbnail */}
      <div className="relative bg-black rounded-t-[15px] overflow-hidden" style={{ aspectRatio: '16/9' }}>
        <div className="w-full h-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgb(30 30 60), rgb(20 20 40))' }}>
          {rec.status === 'processing' ? (
            <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#6366F1" strokeWidth="3" strokeDasharray="60 30" />
            </svg>
          ) : (
            <svg width="32" height="32" fill="none" stroke="#4B5563" strokeWidth="1.5" viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </div>
        {rec.durationSecs && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ background: 'rgba(0,0,0,0.8)', color: 'white' }}>
            {formatDuration(rec.durationSecs)}
          </div>
        )}
        {['ready', 'error'].includes(rec.status) && (
          <Link href={`/v/${rec.slug}`}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.9)' }}>
              <svg width="20" height="20" fill="#1a1a2e" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </Link>
        )}
      </div>

      {/* Info */}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-white leading-tight line-clamp-2 flex-1">
            {['ready', 'error'].includes(rec.status) ? (
              <Link href={`/v/${rec.slug}`} className="hover:text-indigo-400 transition-colors">
                {rec.title}
              </Link>
            ) : rec.title}
          </h3>

          <div className="relative flex-shrink-0">
            <button onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
              style={{ background: 'var(--color-surface)' }}>
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--color-text)' }}>
                <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 rounded-xl shadow-xl w-44 py-1 overflow-hidden"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-surface-border)' }}>
                {['ready', 'error'].includes(rec.status) && (
                  <>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/v/${rec.slug}`); setShowMenu(false) }}
                      className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left"
                      style={{ color: 'var(--color-text)' }}>
                      Copiar enlace
                    </button>
                    <button onClick={() => { setShowMenu(false); wrap(() => onTogglePublic(rec.id, rec.isPublic)) }}
                      className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left"
                      style={{ color: 'var(--color-text)' }}>
                      {rec.isPublic ? 'Hacer privado' : 'Hacer público'}
                    </button>
                    <div className="h-px my-1" style={{ background: 'var(--color-surface-border)' }} />
                  </>
                )}
                <button onClick={() => { setShowMenu(false); setConfirmOpen(true) }}
                  className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left"
                  style={{ color: '#F87171' }}>
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: st.bg, color: st.color }}>{st.label}</span>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span>{rec.viewCount} vista{rec.viewCount !== 1 ? 's' : ''}</span>
            {rec.fileSizeBytes && <span>· {formatBytes(rec.fileSizeBytes)}</span>}
          </div>
        </div>

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{formatDate(rec.createdAt)}</p>

        {['ready', 'error'].includes(rec.status) && (
          <button onClick={() => wrap(() => onProcess(rec.id))} disabled={loading}
            className="w-full text-xs py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, rgb(99 102 241/0.2), rgb(168 85 247/0.2))', border: '1px solid rgb(99 102 241/0.3)', color: '#818CF8' }}>
            {loading
              ? <><svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60 30" /></svg> Procesando...</>
              : <><span>🧠</span> {rec.status === 'error' ? 'Reintentar IA' : 'Procesar con IA'}</>}
          </button>
        )}
        {rec.status === 'processing' && (
          <div className="flex items-center gap-2 text-xs justify-center py-1" style={{ color: '#F59E0B' }}>
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60 30" />
            </svg>
            Analizando con IA...
          </div>
        )}
      </div>

      {/* Confirm delete */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card p-6 w-full max-w-sm space-y-4">
            <h3 className="text-sm font-semibold text-white">¿Eliminar grabación?</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Esta acción no se puede deshacer. El archivo de video también será eliminado.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                Cancelar
              </button>
              <button onClick={() => { setConfirmOpen(false); wrap(() => onDelete(rec.id)) }} disabled={loading}
                className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.2)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RecordingsClient({ initialRecordings }: { initialRecordings: Recording[] }) {
  const [recordings, setRecordings] = useState(initialRecordings)
  const [filterStatus, setFilterStatus] = useState<'all' | Recording['status']>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [notif, setNotif] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [errorModal, setErrorModal] = useState<string | null>(null)

  function showNotif(type: 'success' | 'error', text: string) {
    setNotif({ type, text })
    setTimeout(() => setNotif(null), 4000)
  }

  const handleProcess = useCallback(async (id: string) => {
    setRecordings(prev => prev.map(r => r.id === id ? { ...r, status: 'processing' } : r))
    try {
      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), 180000)
      const res = await fetch('/api/process/recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recording_id: id }),
        signal: controller.signal,
      })
      clearTimeout(tid)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showNotif('success', `✓ IA completó el análisis: ${data.stats.transcript_segments} segmentos`)
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, status: 'ready' } : r))
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? 'El proceso tardó demasiado. Intenta de nuevo.' : err.message)
        : 'Error al procesar'
      setErrorModal(msg)
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, status: 'error' } : r))
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' })
    if (res.ok) { setRecordings(prev => prev.filter(r => r.id !== id)); showNotif('success', 'Grabación eliminada') }
    else showNotif('error', 'Error al eliminar')
  }, [])

  const handleTogglePublic = useCallback(async (id: string, current: boolean) => {
    const res = await fetch(`/api/recordings/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: !current }),
    })
    if (res.ok) {
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, isPublic: !current } : r))
      showNotif('success', !current ? 'Grabación ahora pública' : 'Grabación ahora privada')
    }
  }, [])

  const filtered = recordings.filter(r =>
    (filterStatus === 'all' || r.status === filterStatus) &&
    (!searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const counts = recordings.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {} as Record<string, number>)

  const FILTERS = [
    { id: 'all',        label: `Todas (${recordings.length})` },
    { id: 'ready',      label: `Listas (${counts.ready ?? 0})` },
    { id: 'processing', label: `Procesando (${counts.processing ?? 0})` },
    { id: 'error',      label: `Error (${counts.error ?? 0})` },
  ]

  return (
    <div className="p-8 animate-fade-in">
      {notif && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl animate-slide-up"
          style={{
            background: notif.type === 'success' ? 'rgb(16 185 129/0.15)' : 'rgb(239 68 68/0.15)',
            border: `1px solid ${notif.type === 'success' ? 'rgb(16 185 129/0.4)' : 'rgb(239 68 68/0.4)'}`,
            color: notif.type === 'success' ? '#10B981' : '#F87171',
          }}>
          {notif.text}
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-display-xs font-bold text-white">Mis Grabaciones</h1>
          <p className="text-body-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {recordings.length} grabación{recordings.length !== 1 ? 'es' : ''} en total
          </p>
        </div>
        <Link href="/record" className="btn-record flex items-center gap-2 px-4 py-2.5">
          <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="white" />
          </svg>
          Nueva grabación
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface)' }}>
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilterStatus(f.id as 'all' | Recording['status'])}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
              style={{ background: filterStatus === f.id ? '#6366F1' : 'transparent', color: filterStatus === f.id ? 'white' : 'var(--color-text-muted)' }}>
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="Buscar grabación..."
          className="flex-1 max-w-xs text-sm px-3 py-2 rounded-xl"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)', color: 'white' }} />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">🎬</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            {recordings.length === 0 ? '¡Haz tu primera grabación!' : 'Sin resultados'}
          </h3>
          {recordings.length === 0 && (
            <Link href="/record" className="btn-record flex items-center gap-2 px-6 py-3 mt-4">
              Empezar a grabar
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(rec => (
            <RecordingCard key={rec.id} rec={rec}
              onProcess={handleProcess} onDelete={handleDelete} onTogglePublic={handleTogglePublic} />
          ))}
        </div>
      )}

      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-semibold text-white">Error de Procesamiento</h3>
            <div className="bg-black/40 rounded-lg p-3 text-xs font-mono text-red-300 max-h-48 overflow-y-auto">
              {errorModal}
            </div>
            <button onClick={() => setErrorModal(null)} className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
