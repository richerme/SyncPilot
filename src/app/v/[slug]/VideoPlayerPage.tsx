'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import RecordingStatusBar from '@/components/layout/RecordingStatusBar'

interface Recording {
  id: string; title: string; description: string | null; slug: string; status: string
  videoUrl: string | null; durationSecs: number | null; isPublic: boolean
  isOwner: boolean; viewCount: number; createdAt: string; authorName: string | null
}
interface Segment { id: string; startMs: number; endMs: number; speaker: string | null; text: string }
interface Chapter { id: string; title: string; startMs: number; endMs: number; summary: string | null; orderIndex: number }
interface AiSummary { summaryText: string; keyPoints: string[]; sentiment: string | null }
interface ActionItem { id: string; text: string; assignee: string | null; dueDateText: string | null; isCompleted: boolean }
interface Comment { id: string; timestampMs: number; text: string; guestName: string | null; createdAt: string; authorName: string | null }

function fmtTime(secs: number) {
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' })
}

type Tab = 'transcript' | 'chapters' | 'summary' | 'comments'

export default function VideoPlayerPage({ slug, initialData }: {
  slug: string
  initialData: {
    recording: Recording; transcripts: Segment[]; chapters: Chapter[]
    aiSummary: AiSummary | null; actionItems: ActionItem[]; comments: Comment[]
  }
}) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressRef  = useRef<HTMLDivElement>(null)

  const [currentMs, setCurrentMs]     = useState(0)
  const [isPlaying, setIsPlaying]     = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [duration, setDuration]       = useState(initialData.recording.durationSecs ?? 0)
  const [isCopied, setIsCopied]       = useState(false)
  const [activeTab, setActiveTab]     = useState<Tab>('transcript')
  const [comments, setComments]       = useState(initialData.comments)
  const [speed, setSpeed]             = useState(1)
  const [newComment, setNewComment]   = useState('')
  const [guestName, setGuestName]     = useState('')
  const [isDragging, setIsDragging]   = useState(false)

  const { recording, aiSummary, actionItems } = initialData

  // ── Fix WebM Infinity duration (Chrome MediaRecorder bug) ──────────────
  const fixInfinityDuration = useCallback((vid: HTMLVideoElement) => {
    if (vid.duration === Infinity || isNaN(vid.duration)) {
      vid.currentTime = 1e101
      vid.onseeked = () => {
        vid.onseeked = null
        setDuration(Math.floor(vid.duration))
        vid.currentTime = 0
      }
    } else if (Number.isFinite(vid.duration) && vid.duration > 0) {
      setDuration(Math.floor(vid.duration))
    }
  }, [])

  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onMeta   = () => fixInfinityDuration(vid)
    const onTime   = () => {
      setCurrentMs(vid.currentTime * 1000)
      if (Number.isFinite(vid.duration) && vid.duration > 0) setDuration(Math.floor(vid.duration))
    }
    const onPlay   = () => setIsPlaying(true)
    const onPause  = () => setIsPlaying(false)
    const onEnded  = () => setIsPlaying(false)
    vid.addEventListener('loadedmetadata', onMeta)
    vid.addEventListener('durationchange', onMeta)
    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)
    vid.addEventListener('ended', onEnded)
    return () => {
      vid.removeEventListener('loadedmetadata', onMeta)
      vid.removeEventListener('durationchange', onMeta)
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
      vid.removeEventListener('ended', onEnded)
    }
  }, [fixInfinityDuration])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // ── Video controls ────────────────────────────────────────────────────
  const seekToMs = useCallback((ms: number) => {
    const vid = videoRef.current
    if (!vid) return
    const clampedMs = Math.max(0, Math.min(ms, (vid.duration || duration) * 1000))
    vid.currentTime = clampedMs / 1000
    setCurrentMs(clampedMs)
    vid.play().catch(() => {})
  }, [duration])

  const togglePlay = useCallback(() => {
    const vid = videoRef.current
    if (!vid) return
    isPlaying ? vid.pause() : vid.play()
  }, [isPlaying])

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    document.fullscreenElement ? document.exitFullscreen() : c.requestFullscreen()
  }, [])

  // ── Progress bar click & drag ─────────────────────────────────────────
  const seekFromEvent = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressRef.current
    const vid = videoRef.current
    if (!bar || !vid) return
    const rect = bar.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const realDuration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : duration
    if (realDuration > 0) seekToMs(pct * realDuration * 1000)
  }, [duration, seekToMs])

  const progressPct = useMemo(() => {
    const d = duration > 0 ? duration : 1
    return Math.min(100, (currentMs / 1000 / d) * 100)
  }, [currentMs, duration])

  const activeSegIdx = useMemo(() =>
    initialData.transcripts.findIndex(t => currentMs >= t.startMs && currentMs <= t.endMs),
    [currentMs, initialData.transcripts]
  )

  async function addComment() {
    if (!newComment.trim()) return
    const res = await fetch(`/api/recordings/${recording.id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newComment, timestampMs: currentMs, guestName: guestName || undefined }),
    })
    if (res.ok) {
      const data = await res.json()
      setComments(prev => [...prev, data.comment])
      setNewComment('')
    }
  }

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'transcript', label: 'Transcript', count: initialData.transcripts.length },
    { id: 'chapters',   label: 'Capítulos',  count: initialData.chapters.length },
    { id: 'summary',    label: 'Resumen IA' },
    { id: 'comments',   label: 'Comentarios', count: comments.length },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* Recording bar */}
      <RecordingStatusBar />

      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between"
        style={{ borderColor: 'var(--color-surface-border)', background: 'var(--color-bg-card)' }}>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
            <svg width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="text-sm font-bold text-gradient-sync">SyncPilot</span>
        </Link>
        <div className="flex items-center gap-2">
          {recording.isOwner && (
            <Link href="/recordings" className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              Mis grabaciones
            </Link>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(window.location.href); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{
              background: isCopied ? 'rgb(16 185 129/0.2)' : 'var(--color-surface)',
              color: isCopied ? '#10B981' : 'var(--color-text-secondary)',
              border: `1px solid ${isCopied ? 'rgb(16 185 129/0.4)' : 'var(--color-surface-border)'}`,
            }}>
            {isCopied ? '✓ Copiado' : '↗ Compartir'}
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* Video + Info */}
        <div className="flex-1 min-w-0 space-y-4">
          <div ref={containerRef}
            className="rounded-2xl overflow-hidden group flex flex-col justify-center bg-black"
            style={{ aspectRatio: isFullscreen ? 'auto' : '16/9', position: 'relative' }}>
            {recording.videoUrl ? (
              <video ref={videoRef} src={recording.videoUrl}
                className="w-full h-full object-contain" onClick={togglePlay} style={{ cursor: 'pointer' }} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="text-4xl">{recording.status === 'uploading' || recording.status === 'processing' ? '⏳' : '🎬'}</div>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {recording.status === 'uploading' ? 'Video en proceso de carga...'
                    : recording.status === 'processing' ? 'Procesando video...' : 'Video no disponible'}
                </p>
              </div>
            )}

            {/* Play overlay */}
            {recording.videoUrl && !isPlaying && (
              <button onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-transparent group-hover:bg-black/20 transition-all z-10">
                <div className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                  style={{ background: 'rgb(255 255 255 / 0.9)' }}>
                  <svg width="28" height="28" fill="#1a1a2e" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                </div>
              </button>
            )}

            {/* Controls overlay */}
            {recording.videoUrl && (
              <div className={`absolute bottom-0 left-0 right-0 p-4 pt-12 space-y-2 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity z-20 ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>

                {/* ── Progress bar ── */}
                <div
                  ref={progressRef}
                  className="relative h-1.5 rounded-full cursor-pointer bg-white/25 hover:h-2.5 transition-all"
                  onMouseDown={e => { setIsDragging(true); seekFromEvent(e) }}
                  onMouseMove={e => { if (isDragging) seekFromEvent(e) }}
                  onMouseUp={() => setIsDragging(false)}
                  onMouseLeave={() => setIsDragging(false)}
                  onClick={seekFromEvent}
                >
                  {/* Chapter markers */}
                  {initialData.chapters.map(ch => {
                    const d = duration > 0 ? duration : 1
                    return (
                      <div key={ch.id} className="absolute top-0 h-full w-0.5 bg-white/40 pointer-events-none z-10"
                        style={{ left: `${(ch.startMs / 1000 / d) * 100}%` }} />
                    )
                  })}
                  {/* Fill bar — RED, tracks progress */}
                  <div
                    className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
                    style={{ width: `${progressPct}%`, background: '#EF4444', transition: isDragging ? 'none' : 'width 0.1s linear' }}
                  />
                  {/* Thumb */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg pointer-events-none opacity-0 group-hover/progress:opacity-100"
                    style={{ left: `calc(${progressPct}% - 6px)` }}
                  />
                </div>

                <div className="flex items-center justify-between text-white">
                  <div className="flex items-center gap-4">
                    <button onClick={togglePlay} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform">
                      {isPlaying
                        ? <svg width="18" height="18" fill="white" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                        : <svg width="18" height="18" fill="white" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>}
                    </button>
                    <span className="text-xs font-mono opacity-90">
                      {fmtTime(Math.floor(currentMs / 1000))} / {fmtTime(duration)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {[0.5, 1, 1.25, 1.5, 2].map(s => (
                        <button key={s}
                          onClick={() => { if (videoRef.current) videoRef.current.playbackRate = s; setSpeed(s) }}
                          className="text-[11px] px-1.5 py-0.5 rounded font-mono opacity-80 hover:opacity-100"
                          style={{ background: speed === s ? 'rgba(255,255,255,0.2)' : 'transparent', fontWeight: speed === s ? 700 : 400 }}>
                          {s}x
                        </button>
                      ))}
                    </div>
                    <button onClick={toggleFullscreen} className="w-8 h-8 flex items-center justify-center hover:scale-110 transition-transform">
                      <svg width="20" height="20" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <h1 className="text-title-lg font-bold text-white">{recording.title}</h1>
            <div className="flex items-center gap-3 flex-wrap text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              <span>{recording.authorName ?? 'Usuario'}</span>
              <span>· {recording.viewCount} vistas</span>
              {duration > 0 && <span>· {fmtTime(duration)}</span>}
              <span>· {formatDate(recording.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Sidebar tabs */}
        <div className="w-80 flex-shrink-0 space-y-3">
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-surface)' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className="flex-1 text-xs py-1.5 rounded-lg font-medium transition-all"
                style={{ background: activeTab === t.id ? '#6366F1' : 'transparent', color: activeTab === t.id ? 'white' : 'var(--color-text-muted)' }}>
                {t.label}{t.count ? ` (${t.count})` : ''}
              </button>
            ))}
          </div>

          <div className="card p-4 max-h-[600px] overflow-y-auto">
            {activeTab === 'transcript' && (
              <div className="space-y-1">
                {initialData.transcripts.length === 0
                  ? <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Usa &quot;Procesar con IA&quot; para generar la transcripción</p>
                  : initialData.transcripts.map((seg, i) => (
                    <div key={seg.id} onClick={() => seekToMs(seg.startMs)}
                      className={`transcript-line ${i === activeSegIdx ? 'active' : ''}`}>
                      <span className="text-xs mr-2 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                        {fmtTime(Math.round(seg.startMs / 1000))}
                      </span>
                      {seg.speaker && <span className="text-xs font-semibold mr-1" style={{ color: '#818CF8' }}>{seg.speaker}:</span>}
                      <span className="text-sm text-white">{seg.text}</span>
                    </div>
                  ))}
              </div>
            )}

            {activeTab === 'chapters' && (
              <div className="space-y-2">
                {initialData.chapters.length === 0
                  ? <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Sin capítulos</p>
                  : initialData.chapters.map(ch => (
                    <button key={ch.id} onClick={() => seekToMs(ch.startMs)}
                      className="w-full text-left p-3 rounded-lg hover:bg-white/5 transition-colors space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: '#818CF8' }}>{fmtTime(Math.round(ch.startMs / 1000))}</span>
                        <span className="text-sm font-medium text-white">{ch.title}</span>
                      </div>
                      {ch.summary && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{ch.summary}</p>}
                    </button>
                  ))}
              </div>
            )}

            {activeTab === 'summary' && (
              <div className="space-y-4">
                {!aiSummary
                  ? <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Procesa el video con IA para obtener el resumen</p>
                  : <>
                    {aiSummary.sentiment && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: aiSummary.sentiment === 'positive' ? 'rgb(16 185 129/0.1)' : aiSummary.sentiment === 'negative' ? 'rgb(239 68 68/0.1)' : 'var(--color-surface)',
                          color: aiSummary.sentiment === 'positive' ? '#10B981' : aiSummary.sentiment === 'negative' ? '#EF4444' : 'var(--color-text-secondary)',
                        }}>
                        {aiSummary.sentiment === 'positive' ? 'Positivo' : aiSummary.sentiment === 'negative' ? 'Negativo' : 'Neutral'}
                      </span>
                    )}
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Resumen</p>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{aiSummary.summaryText}</p>
                    </div>
                    {aiSummary.keyPoints?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Puntos clave</p>
                        <ul className="space-y-1.5">
                          {aiSummary.keyPoints.map((pt, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                                style={{ background: '#6366F1', color: 'white' }}>{i + 1}</span>
                              <span style={{ color: 'var(--color-text)' }}>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {actionItems.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Action Items</p>
                        <ul className="space-y-2">
                          {actionItems.map(item => (
                            <li key={item.id} className="flex items-start gap-2 text-sm">
                              <span className="flex-shrink-0 mt-0.5">{item.isCompleted ? '✅' : '○'}</span>
                              <div>
                                <span style={{ color: 'var(--color-text)' }}>{item.text}</span>
                                {item.assignee && <span className="text-xs ml-1" style={{ color: '#818CF8' }}>@{item.assignee}</span>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>}
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="space-y-3">
                {comments.length === 0
                  ? <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-muted)' }}>Sin comentarios aún</p>
                  : comments.map(c => (
                    <div key={c.id} className="p-2 rounded-lg space-y-1" style={{ background: 'var(--color-surface)' }}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => seekToMs(c.timestampMs)} className="text-xs font-mono" style={{ color: '#818CF8' }}>
                          {fmtTime(Math.round(c.timestampMs / 1000))}
                        </button>
                        <span className="text-xs font-semibold text-white">{c.authorName ?? 'Anónimo'}</span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{c.text}</p>
                    </div>
                  ))}
                <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--color-surface-border)' }}>
                  <input type="text" value={guestName} onChange={e => setGuestName(e.target.value)}
                    placeholder="Tu nombre (opcional)" className="input-field text-xs py-1.5" />
                  <div className="flex gap-2">
                    <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addComment()}
                      placeholder={`Comentar en ${fmtTime(Math.floor(currentMs / 1000))}...`}
                      className="input-field text-xs py-1.5 flex-1" />
                    <button onClick={addComment} className="px-3 rounded-lg text-xs font-semibold"
                      style={{ background: '#6366F1', color: 'white' }}>+</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
