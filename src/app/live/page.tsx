'use client'

import { useLiveSession } from '@/features/live/hooks/useLiveSession'
import { useEffect, useRef, useState } from 'react'

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

const SUGGESTION_ICONS: Record<string, string> = {
  reply: '💬', question: '❓', info: 'ℹ️', warning: '⚠️',
}
const SUGGESTION_COLORS: Record<string, string> = {
  reply: '#6366F1', question: '#06B6D4', info: '#10B981', warning: '#F59E0B',
}

export default function LivePage() {
  const session = useLiveSession()
  const [customPrompt, setCustomPrompt] = useState('')
  const [isAskingAI, setIsAskingAI] = useState(false)
  const [docCount, setDocCount] = useState(0)
  const [showDebug, setShowDebug] = useState(false)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const suggestionsScrollRef = useRef<HTMLDivElement>(null)
  const isSuggestionsAtBottom = useRef(true)

  // Cargar documentos de contexto
  useEffect(() => {
    fetch('/api/documents/content')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.count > 0) { setDocCount(data.count); session.setDocumentContext(data.context) }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll transcript
  useEffect(() => {
    const c = transcriptScrollRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [session.transcript.length, session.interimText])

  // Auto-scroll sugerencias
  useEffect(() => {
    const c = suggestionsScrollRef.current
    if (!c) return
    setTimeout(() => {
      if (isSuggestionsAtBottom.current || session.suggestions.length <= 3) {
        c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
      }
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

      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-surface-border)', background: 'var(--color-bg-card)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
            <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="font-bold text-sm text-gradient-sync">SyncPilot · IA en Vivo</span>

          {docCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgb(99 102 241 / 0.15)', color: '#818CF8', border: '1px solid rgb(99 102 241 / 0.3)' }}>
              📄 {docCount} doc{docCount > 1 ? 's' : ''}
            </span>
          )}

          {isActive && (
            <div className="flex items-center gap-2 ml-4">
              <div className="recording-dot" />
              <span className="text-xs font-mono font-bold text-red-400">{formatDuration(session.duration)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {session.wordCount.toLocaleString()} palabras
              </span>
              <span className="text-xs px-2 py-1 rounded-full flex items-center gap-1"
                style={{ background: 'rgb(16 185 129 / 0.1)', color: '#10B981' }}>
                <span className={`w-1.5 h-1.5 rounded-full bg-green-400 ${session.isListening ? 'animate-pulse' : ''}`} />
                {session.isListening ? '🎧 Pestaña + Mic' : 'En pausa'}
              </span>
            </>
          )}
          <a href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
            ← Dashboard
          </a>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">

        {/* Transcript */}
        <div className="flex-1 flex flex-col border-r" style={{ borderColor: 'var(--color-surface-border)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--color-surface-border)' }}>
            <h2 className="text-sm font-semibold text-white">Transcripción en vivo</h2>
            {session.transcript.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {session.transcript.length} fragmentos
              </span>
            )}
          </div>

          <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
            {session.transcript.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="text-4xl mb-3">🎙️</div>
                <p className="text-sm font-medium text-white">
                  {isIdle ? 'Inicia la sesión para comenzar' : isActive ? 'Escuchando...' : 'Sin transcripción'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {isActive ? 'Habla durante la reunión. La transcripción aparecerá aquí.' : 'Usa Chrome o Edge.'}
                </p>
              </div>
            ) : (
              session.transcript.map((seg, i) => (
                <div key={seg.id}
                  className={`transcript-line ${i === session.transcript.length - 1 ? 'active' : ''}`}>
                  <span className="text-xs mr-2 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {formatDuration(Math.round(seg.start_ms / 1000))}
                  </span>
                  <span className="text-sm text-white">{seg.text}</span>
                </div>
              ))
            )}
            {isActive && session.interimText && (
              <div className="transcript-line active opacity-70">
                <span className="text-xs mr-2" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                <span className="text-sm text-white italic">{session.interimText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Copiloto IA */}
        <div className="w-80 flex flex-col" style={{ background: 'var(--color-bg-card)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b"
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

          <div ref={suggestionsScrollRef}
            onScroll={() => {
              const c = suggestionsScrollRef.current
              if (c) isSuggestionsAtBottom.current = c.scrollHeight - c.scrollTop - c.clientHeight < 50
            }}
            className="flex-1 overflow-y-auto p-3 space-y-2">
            {session.suggestions.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {isActive ? 'Las sugerencias aparecerán automáticamente...' : 'Inicia la sesión para recibir sugerencias'}
                </p>
              </div>
            ) : (
              session.suggestions.map((s, i) => (
                <div key={s.id ?? i} className={`suggestion-card type-${s.type} animate-slide-up`}>
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0">{SUGGESTION_ICONS[s.type] ?? '💡'}</span>
                    <p className="text-xs text-white leading-relaxed">{s.text}</p>
                  </div>
                  <div className="flex justify-end mt-2">
                    <button onClick={() => navigator.clipboard.writeText(s.text)}
                      className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: SUGGESTION_COLORS[s.type] ?? '#818CF8' }}>
                      Copiar ↗
                    </button>
                  </div>
                </div>
              ))
            )}
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
              style={{ background: 'rgb(239 68 68 / 0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
              {session.error}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 py-4 border-t flex items-center justify-center gap-4"
        style={{ borderColor: 'var(--color-surface-border)', background: 'var(--color-bg-card)' }}>

        {isIdle && (
          <div className="flex flex-col items-center gap-3 w-full max-w-lg">
            {/* Info */}
            <div className="text-xs text-left space-y-2 p-4 rounded-xl border w-full"
              style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
              <p className="font-semibold text-white flex items-center gap-2">
                <span>🎧</span> Reunión Completa — Pestaña + Micrófono
              </p>
              <p style={{ color: 'var(--color-text-secondary)' }}>
                Captura el audio de la reunión (pestaña del navegador) más tu voz (micrófono). Funciona con Teams Web, Zoom Web, Google Meet, etc.
              </p>
              <p style={{ color: 'var(--color-text-muted)' }}>
                Tip: Al compartir pantalla, selecciona la <strong>pestaña</strong> donde está la reunión y marca &quot;Compartir audio de la pestaña&quot;.
              </p>
            </div>

            <button onClick={session.startSession}
              className="btn-primary flex items-center gap-2 px-8 py-3">
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
              style={{ background: 'rgb(239 68 68 / 0.2)', border: '1px solid rgb(239 68 68/0.4)', color: '#EF4444' }}>
              <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              Finalizar sesión
            </button>
          </>
        )}

        {isDone && (
          <div className="flex items-center gap-4">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              ✓ Sesión finalizada · {session.wordCount.toLocaleString()} palabras · {formatDuration(session.duration)}
            </p>
            <button onClick={session.resetSession}
              className="text-sm px-5 py-2 rounded-lg font-semibold"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              Nueva sesión
            </button>
            <a href="/meetings" className="btn-primary text-sm px-5 py-2">Ver en Reuniones</a>
          </div>
        )}
      </footer>

      {/* Debug Panel */}
      <div className="border-t" style={{ borderColor: 'var(--color-surface-border)' }}>
        <button onClick={() => setShowDebug(p => !p)}
          className="w-full text-left px-4 py-1.5 text-xs font-mono"
          style={{ color: 'var(--color-text-muted)', background: 'rgba(0,0,0,0.3)' }}>
          {showDebug ? '▼' : '▶'} Debug Logs ({session.debugLogs.length})
        </button>
        {showDebug && (
          <div className="max-h-48 overflow-y-auto px-4 py-2 text-xs font-mono space-y-0.5"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#86efac' }}>
            {session.debugLogs.length === 0
              ? <p className="text-slate-500">No logs yet.</p>
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
