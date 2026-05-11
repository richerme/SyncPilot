'use client'

import { useLiveSession } from '@/features/live/hooks/useLiveSession'
import { useEffect, useRef, useState } from 'react'
import RecordingStatusBar from '@/components/layout/RecordingStatusBar'

function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

const ICONS:  Record<string, string> = { reply: '💬', question: '❓', info: 'ℹ️', warning: '⚠️' }
const COLORS: Record<string, string> = { reply: '#6366F1', question: '#06B6D4', info: '#10B981', warning: '#F59E0B' }

// Colores de speaker
const SPEAKER_STYLES = {
  me:      { color: '#818CF8', label: 'Tú' },       // Índigo (voz propia)
  meeting: { color: '#e2e8f0', label: 'Reunión' },  // Blanco (audio de reunión)
  null:    { color: '#e2e8f0', label: '' },
}

export default function LivePage() {
  const session = useLiveSession()
  const [customPrompt, setCustomPrompt] = useState('')
  const [isAskingAI,   setIsAskingAI]   = useState(false)
  const [docCount,     setDocCount]     = useState(0)
  const [showDebug,    setShowDebug]    = useState(false)

  // Live Translator state (loaded from localStorage)
  const [liveTranslatorEnabled, setLiveTranslatorEnabled] = useState(false)
  const [liveTranslatorLang, setLiveTranslatorLang]       = useState('es')
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const translatingRef = useRef<Set<string>>(new Set())

  const transcriptRef     = useRef<HTMLDivElement>(null)
  const suggestRef        = useRef<HTMLDivElement>(null)
  const atBottomSuggest   = useRef(true)

  useEffect(() => {
    fetch('/api/documents/content')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.count > 0) { setDocCount(d.count); session.setDocumentContext(d.context) } })
      .catch(() => {})
    // Cargar config de Live Translator desde localStorage
    try {
      setLiveTranslatorEnabled(localStorage.getItem('syncpilot_live_translator_enabled') === 'true')
      setLiveTranslatorLang(localStorage.getItem('syncpilot_live_translator_lang') ?? 'es')
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Traducir nuevos segmentos si Live Translator está activo
  useEffect(() => {
    if (!liveTranslatorEnabled || session.transcript.length === 0) return
    const last = session.transcript[session.transcript.length - 1]
    if (!last || translatingRef.current.has(last.id) || translations[last.id]) return
    if (last.text.split(' ').length < 3) return  // segmentos muy cortos no se traducen
    translatingRef.current.add(last.id)
    fetch('/api/audio-tools/translate-segment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: last.text, target_lang: liveTranslatorLang }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.translated) setTranslations(prev => ({ ...prev, [last.id]: d.translated }))
      })
      .catch(() => {})
      .finally(() => { translatingRef.current.delete(last.id) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.transcript.length, liveTranslatorEnabled])

  // Auto-scroll transcript
  useEffect(() => {
    const c = transcriptRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [session.transcript.length, session.interimText])

  // Auto-scroll suggestions
  useEffect(() => {
    const c = suggestRef.current
    if (!c) return
    setTimeout(() => {
      if (atBottomSuggest.current || session.suggestions.length <= 3)
        c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
    }, 100)
  }, [session.suggestions.length])

  async function handleAskAI() {
    if (!customPrompt.trim()) { await session.askAI(); return }
    setIsAskingAI(true)
    await session.askAI(customPrompt)
    setCustomPrompt('')
    setIsAskingAI(false)
  }

  const isActive  = session.status === 'active'
  const isIdle    = session.status === 'idle'
  const isDone    = session.status === 'done'
  const isLoading = session.status === 'starting' || session.status === 'ending'

  return (
    <div className="h-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>

      {/* Recording bar */}
      <RecordingStatusBar />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-surface-border)', background: 'var(--color-bg-card)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="9" width="13" height="9" rx="1.6" fill="white"/>
              <path d="M16 11.2 L21 9 L21 18 L16 15.8 Z" fill="white"/>
              <circle cx="9.5" cy="13.5" r="1.5" fill="#6366F1"/>
              <circle cx="14" cy="10.5" r="0.9" fill="#EF4444"/>
            </svg>
          </div>
          <span className="font-bold text-sm text-gradient-sync">SyncPilot · IA en Vivo</span>

          {docCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgb(99 102 241/0.15)', color: '#818CF8', border: '1px solid rgb(99 102 241/0.3)' }}>
              📄 {docCount} doc{docCount > 1 ? 's' : ''}
            </span>
          )}
          {liveTranslatorEnabled && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#06B6D4', border: '1px solid rgba(6,182,212,0.3)' }}>
              🌐 Trad. {liveTranslatorLang.toUpperCase()}
            </span>
          )}

          {isActive && (
            <div className="flex items-center gap-2 ml-4">
              <div className="recording-dot" />
              <span className="text-xs font-mono font-bold text-red-400">{fmtDuration(session.duration)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {session.wordCount.toLocaleString()} palabras
              </span>
              <span className="text-xs px-2 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: session.audioTracksOk ? 'rgb(16 185 129/0.1)' : 'rgb(245 158 11/0.1)', color: session.audioTracksOk ? '#10B981' : '#F59E0B' }}>
                <span className={`w-1.5 h-1.5 rounded-full ${session.audioTracksOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
                {session.audioTracksOk ? '🎧 Pestaña + Mic' : '🎙️ Solo Mic'}
              </span>
            </>
          )}
          <a href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
            ← Dashboard
          </a>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">

        {/* Columna transcript */}
        <div className="flex-1 flex flex-col border-r" style={{ borderColor: 'var(--color-surface-border)' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b text-sm font-semibold text-white"
            style={{ borderColor: 'var(--color-surface-border)' }}>
            <span>Transcripción en vivo</span>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {session.transcript.length > 0 && <span>{session.transcript.length} fragmentos</span>}
              {/* Leyenda de colores */}
              {isActive && (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />Tú</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />Reunión</span>
                </div>
              )}
            </div>
          </div>

          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {session.transcript.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="text-4xl mb-3">🎙️</div>
                <p className="text-sm font-medium text-white">
                  {isIdle ? 'Inicia la sesión para comenzar' : isActive ? 'Escuchando...' : 'Sin transcripción'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {isActive ? 'Tu voz aparece en azul, el audio de reunión en blanco.'
                    : 'Usa Chrome o Edge. La reunión debe estar en una pestaña del navegador.'}
                </p>
              </div>
            ) : (
              session.transcript.map((seg, i) => {
                const sp = SPEAKER_STYLES[seg.speaker ?? 'null'] ?? SPEAKER_STYLES['meeting']
                return (
                  <div key={seg.id}
                    className={`transcript-line ${i === session.transcript.length - 1 ? 'active' : ''}`}>
                    <span className="text-xs mr-1.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                      {fmtDuration(Math.round(seg.start_ms / 1000))}
                    </span>
                    {seg.speaker && (
                      <span className="text-xs font-semibold mr-1.5 flex-shrink-0"
                        style={{ color: sp.color }}>
                        {sp.label}:
                      </span>
                    )}
                    <span className="text-sm" style={{ color: sp.color }}>{seg.text}</span>
                    {liveTranslatorEnabled && translations[seg.id] && (
                      <span className="text-xs italic ml-1 opacity-70 block mt-0.5"
                        style={{ color: '#06B6D4' }}>
                        🌐 {translations[seg.id]}
                      </span>
                    )}
                  </div>
                )
              })
            )}

            {/* Interim (preview en tiempo real de la voz del usuario) */}
            {isActive && session.interimText && (
              <div className="transcript-line active opacity-60">
                <span className="text-xs mr-1.5" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                <span className="text-xs font-semibold mr-1.5" style={{ color: '#818CF8' }}>Tú:</span>
                <span className="text-sm italic" style={{ color: '#818CF8' }}>{session.interimText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Columna Copiloto */}
        <div className="w-80 flex flex-col" style={{ background: 'var(--color-bg-card)' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ borderColor: 'var(--color-surface-border)' }}>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #6366F1, #A855F7)' }}>
                <svg width="10" height="10" fill="white" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-white">Copiloto IA</h2>
            </div>
            {session.suggestions.length > 0 && (
              <button onClick={session.clearSuggestions} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Limpiar
              </button>
            )}
          </div>

          <div ref={suggestRef}
            onScroll={() => {
              const c = suggestRef.current
              if (c) atBottomSuggest.current = c.scrollHeight - c.scrollTop - c.clientHeight < 50
            }}
            className="flex-1 overflow-y-auto p-3 space-y-2">
            {session.suggestions.length === 0
              ? <p className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {isActive ? 'Las sugerencias aparecerán automáticamente...' : 'Inicia la sesión para recibir sugerencias'}
              </p>
              : session.suggestions.map((s, i) => (
                <div key={s.id ?? i} className={`suggestion-card type-${s.type} animate-slide-up`}>
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0">{ICONS[s.type] ?? '💡'}</span>
                    <p className="text-xs text-white leading-relaxed">{s.text}</p>
                  </div>
                  <div className="flex justify-end mt-2">
                    <button onClick={() => navigator.clipboard.writeText(s.text)}
                      className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: COLORS[s.type] ?? '#818CF8' }}>
                      Copiar ↗
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {isActive && (
            <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--color-surface-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Pregunta algo a la IA</p>
              <div className="flex gap-2">
                <input type="text" value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskAI()}
                  placeholder="¿Cómo responder a esto?"
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-transparent border text-white"
                  style={{ borderColor: 'var(--color-surface-border)' }} />
                <button onClick={handleAskAI} disabled={isAskingAI}
                  className="px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: 'linear-gradient(135deg, #6366F1, #4F46E5)', color: 'white' }}>
                  {isAskingAI ? '...' : 'Ask'}
                </button>
              </div>
            </div>
          )}

          {session.error && (
            <div className="mx-3 mb-3 p-3 rounded-lg text-xs"
              style={{ background: 'rgb(239 68 68/0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
              {session.error}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t flex items-center justify-center gap-4 flex-shrink-0"
        style={{ borderColor: 'var(--color-surface-border)', background: 'var(--color-bg-card)' }}>

        {isIdle && (
          <div className="flex flex-col items-center gap-3 w-full max-w-xl">
            {/* Instrucciones */}
            <div className="w-full p-4 rounded-xl border text-xs space-y-2"
              style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
              <p className="font-semibold text-white text-sm">🎧 Reunión Completa — Cómo usarlo</p>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: '#10B981' }}>Paso 1:</strong> Abre tu reunión (Teams, Zoom, Meet) en <strong>una pestaña del navegador</strong> (versión web).
              </p>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: '#10B981' }}>Paso 2:</strong> Al hacer clic en &quot;Iniciar&quot;, selecciona esa <strong>pestaña</strong> en el diálogo del navegador y activa <strong>✓ Compartir audio de la pestaña</strong>.
              </p>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: '#818CF8' }}>Tu voz</strong> aparecerá en <span style={{ color: '#818CF8' }}>azul</span> (instantáneo via micrófono) · <strong>Otros</strong> aparecerán en <span style={{ color: '#e2e8f0' }}>blanco</span> (audio de pestaña, ~2s de delay).
              </p>
            </div>

            <button onClick={session.startSession} className="btn-primary flex items-center gap-2 px-8 py-3">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Iniciar sesión de IA
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60 30" />
            </svg>
            {session.status === 'starting' ? 'Iniciando...' : 'Finalizando...'}
          </div>
        )}

        {isActive && (
          <>
            <button onClick={() => session.askAI()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'linear-gradient(135deg, rgb(99 102 241/0.2), rgb(168 85 247/0.2))', border: '1px solid rgb(99 102 241/0.4)', color: '#818CF8' }}>
              🧠 Sugerir respuesta
            </button>
            <button onClick={session.endSession}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgb(239 68 68/0.2)', border: '1px solid rgb(239 68 68/0.4)', color: '#EF4444' }}>
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              Finalizar sesión
            </button>
          </>
        )}

        {isDone && (
          <div className="flex items-center gap-4">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              ✓ Sesión finalizada · {session.wordCount.toLocaleString()} palabras · {fmtDuration(session.duration)}
            </p>
            <button onClick={session.resetSession} className="text-sm px-5 py-2 rounded-lg font-semibold"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              Nueva sesión
            </button>
            <a href="/meetings" className="btn-primary text-sm px-5 py-2">Ver en Reuniones</a>
          </div>
        )}
      </footer>

      {/* Debug */}
      <div className="border-t flex-shrink-0" style={{ borderColor: 'var(--color-surface-border)' }}>
        <button onClick={() => setShowDebug(p => !p)}
          className="w-full text-left px-4 py-1 text-xs font-mono"
          style={{ color: 'var(--color-text-muted)', background: 'rgba(0,0,0,0.3)' }}>
          {showDebug ? '▼' : '▶'} Debug ({session.debugLogs.length})
        </button>
        {showDebug && (
          <div className="max-h-32 overflow-y-auto px-4 py-2 text-xs font-mono space-y-0.5"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#86efac' }}>
            {session.debugLogs.length === 0
              ? <p className="text-slate-500">Sin logs.</p>
              : session.debugLogs.map((log, i) => (
                <p key={i} className={log.includes('ERROR') ? 'text-red-400' : log.includes('SKIPPED') ? 'text-amber-400' : ''}>
                  {log}
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
