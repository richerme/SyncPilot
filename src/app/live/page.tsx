'use client'

import { useLiveSession, type CopilotAnswer, type TranscriptSegment } from '@/features/live/hooks/useLiveSession'
import { useLiveTranslation, useTranslatorSettings } from '@/features/live/hooks/useLiveTranslation'
import { COPILOT_NAME } from '@/features/live/copilot/profile'
import Link from 'next/link'
import { memo, useEffect, useRef, useState } from 'react'
import RecordingStatusBar from '@/components/layout/RecordingStatusBar'

function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

// Idioma en el que hablas tú (reconocimiento de voz del navegador). El audio de la
// reunión se detecta solo; este ajuste es únicamente para tu micrófono.
const VOICE_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'es-MX', label: 'Español' },
] as const
const VOICE_LANG_KEY = 'syncpilot_voice_lang'

const TRIGGER_LABEL: Record<CopilotAnswer['trigger'], string> = {
  name: 'Te nombraron', button: 'Responder', typed: 'Tu pregunta',
}

// Colores de speaker
const SPEAKER_STYLES = {
  me:      { color: '#818CF8', label: 'Tú' },       // Índigo (voz propia)
  meeting: { color: '#e2e8f0', label: 'Reunión' },  // Blanco (audio de reunión)
  null:    { color: '#e2e8f0', label: '' },
}

// Cada fila memoizada por separado: al llegar un fragmento nuevo solo se pinta ese
// (y el anterior, que deja de ser el último). En reuniones de 1-2 h hay cientos de
// filas y re-pintarlas todas en cada fragmento era lo que pesaba.
const TranscriptRow = memo(function TranscriptRow({ seg, isLast }: { seg: TranscriptSegment; isLast: boolean }) {
  const sp = SPEAKER_STYLES[seg.speaker ?? 'null'] ?? SPEAKER_STYLES.meeting
  return (
    <div className={`transcript-line ${isLast ? 'active' : ''}`}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {fmtDuration(Math.round(seg.start_ms / 1000))}
      </span>
      {seg.speaker && <span className="text-xs font-semibold flex-shrink-0" style={{ color: sp.color }}>{sp.label}:</span>}
      <span className="text-sm break-words min-w-0" style={{ color: sp.color }}>{seg.text}</span>
    </div>
  )
})

// Panel derecho: la misma conversación, traducida, con el mismo tiempo y quién habla.
const TranslationRow = memo(function TranslationRow({ seg, translated, isLast }: { seg: TranscriptSegment; translated: string | undefined; isLast: boolean }) {
  const sp = SPEAKER_STYLES[seg.speaker ?? 'null'] ?? SPEAKER_STYLES.meeting
  return (
    <div className={`transcript-line ${isLast ? 'active' : ''}`}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {fmtDuration(Math.round(seg.start_ms / 1000))}
      </span>
      {seg.speaker && <span className="text-xs font-semibold flex-shrink-0" style={{ color: sp.color }}>{sp.label}:</span>}
      {translated
        ? <span className="text-sm break-words min-w-0" style={{ color: '#67E8F9' }}>{translated}</span>
        : <span className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>Traduciendo…</span>}
    </div>
  )
})

/** Mantiene un panel abajo mientras llega texto, salvo que el usuario haya subido a leer. */
function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !atBottom.current) return
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => { c.scrollTop = c.scrollHeight })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  const onScroll = () => {
    const c = ref.current
    if (c) atBottom.current = c.scrollHeight - c.scrollTop - c.clientHeight < 80
  }
  return { ref, onScroll }
}

const AnswerCard = memo(function AnswerCard({ answer }: { answer: CopilotAnswer }) {
  const [copied, setCopied] = useState(false)
  const streaming = answer.status === 'streaming'
  return (
    <div className="suggestion-card type-reply animate-slide-up space-y-1.5">
      <p className="text-[11px] line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>
        {TRIGGER_LABEL[answer.trigger]}{answer.question ? ` · ${answer.question}` : ''}
      </p>
      <p className="text-sm text-white leading-relaxed whitespace-pre-wrap"
        style={answer.status === 'error' ? { color: '#F87171' } : undefined}>
        {answer.text || (streaming ? 'Thinking…' : '')}
        {streaming && answer.text && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle animate-pulse bg-indigo-300" />}
      </p>
      {answer.status === 'done' && (
        <div className="flex justify-end">
          <button onClick={() => { navigator.clipboard.writeText(answer.text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="text-xs opacity-60 hover:opacity-100 transition-opacity" style={{ color: '#818CF8' }}>
            {copied ? 'Copiado ✓' : 'Copiar ↗'}
          </button>
        </div>
      )}
    </div>
  )
})

export default function LivePage() {
  const session = useLiveSession()
  const [customPrompt, setCustomPrompt] = useState('')
  const [docCount,     setDocCount]     = useState(0)
  const [showDebug,    setShowDebug]    = useState(false)
  const [voiceLang,    setVoiceLang]    = useState<string>('en-US')

  // Traducción a la derecha de la transcripción: solo si está activa en
  // Voice AI Tools → Live Translator (si se cambia allá, se aplica aquí al momento).
  const translator = useTranslatorSettings()
  const { translations, interimTranslation } = useLiveTranslation({
    enabled: translator.enabled, lang: translator.lang,
    transcript: session.transcript, meetingInterim: session.meetingInterim,
  })

  const answersRef = useRef<HTMLDivElement>(null)
  const transcriptPane  = useStickToBottom([session.transcript.length, session.interimText, session.meetingInterim])
  const translationPane = useStickToBottom([session.transcript.length, translations, interimTranslation, session.meetingInterim])

  useEffect(() => {
    fetch('/api/documents/content')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.count > 0) setDocCount(d.count) })
      .catch(() => {})
    try { setVoiceLang(localStorage.getItem(VOICE_LANG_KEY) ?? 'en-US') } catch { /* ignore */ }
  }, [])

  // La respuesta más nueva siempre a la vista, también mientras se escribe.
  const lastAnswer = session.answers[session.answers.length - 1]
  useEffect(() => {
    const c = answersRef.current
    if (c) c.scrollTop = c.scrollHeight
  }, [session.answers.length, lastAnswer?.text, session.nameHeard])

  function chooseVoiceLang(code: string) {
    setVoiceLang(code)
    try { localStorage.setItem(VOICE_LANG_KEY, code) } catch { /* ignore */ }
  }

  async function handleAsk() {
    const text = customPrompt.trim()
    setCustomPrompt('')
    await session.askCopilot(text || undefined)
  }

  const isActive  = session.status === 'active'
  const isIdle    = session.status === 'idle'
  const isDone    = session.status === 'done'
  const isLoading = session.status === 'starting' || session.status === 'ending'
  const copilotBusy = lastAnswer?.status === 'streaming'
  const lastIdx = session.transcript.length - 1

  return (
    <div className="h-screen flex flex-col overflow-hidden"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>

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
          {translator.enabled && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#06B6D4', border: '1px solid rgba(6,182,212,0.3)' }}>
              🌐 Trad. {translator.lang.toUpperCase()}
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
                {session.audioTracksOk ? '🎧 Reunión + Tu voz' : '🎙️ Solo tu voz'}
              </span>
            </>
          )}
          <Link href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
            ← Dashboard
          </Link>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">

        {/* Columna transcript */}
        <div className="flex-1 min-w-0 flex flex-col border-r" style={{ borderColor: 'var(--color-surface-border)' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b text-sm font-semibold text-white"
            style={{ borderColor: 'var(--color-surface-border)' }}>
            <span>Transcripción en vivo</span>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {session.transcript.length > 0 && <span>{session.transcript.length} fragmentos</span>}
              {isActive && (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />Tú</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />Reunión</span>
                </div>
              )}
            </div>
          </div>

          <div ref={transcriptPane.ref} onScroll={transcriptPane.onScroll}
            className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {session.transcript.length === 0 && !session.interimText && !session.meetingInterim ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="text-4xl mb-3">🎙️</div>
                <p className="text-sm font-medium text-white">
                  {isIdle ? 'Inicia la sesión para comenzar' : isActive ? 'Escuchando...' : 'Sin transcripción'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {isActive ? 'Tu voz aparece en azul, el audio de la reunión en blanco.'
                    : 'Usa Chrome o Edge. Comparte la pestaña/pantalla de la reunión con audio.'}
                </p>
              </div>
            ) : (
              session.transcript.map((seg, i) => <TranscriptRow key={seg.id} seg={seg} isLast={i === lastIdx} />)
            )}

            {/* Preview en tiempo real del audio de la reunión (blanco) */}
            {isActive && session.meetingInterim && (
              <div className="transcript-line active opacity-70">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                <span className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>Reunión:</span>
                <span className="text-sm italic break-words min-w-0" style={{ color: '#e2e8f0' }}>{session.meetingInterim}</span>
              </div>
            )}

            {/* Preview en tiempo real de la voz del usuario (azul) */}
            {isActive && session.interimText && (
              <div className="transcript-line active opacity-60">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                <span className="text-xs font-semibold" style={{ color: '#818CF8' }}>Tú:</span>
                <span className="text-sm italic break-words min-w-0" style={{ color: '#818CF8' }}>{session.interimText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Columna traducción (división vertical): solo si está activa en Live Translator */}
        {translator.enabled && (
          <div className="flex-1 min-w-0 flex flex-col border-r" style={{ borderColor: 'var(--color-surface-border)' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b text-sm font-semibold text-white"
              style={{ borderColor: 'var(--color-surface-border)' }}>
              <span>🌐 Traducción ({translator.lang.toUpperCase()})</span>
              <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>se actualiza mientras hablan</span>
            </div>
            <div ref={translationPane.ref} onScroll={translationPane.onScroll}
              className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {session.transcript.length === 0 && !session.meetingInterim ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aquí aparecerá la traducción de la reunión.</p>
                </div>
              ) : (
                session.transcript.map((seg, i) => (
                  <TranslationRow key={seg.id} seg={seg} translated={translations[seg.id]} isLast={i === lastIdx} />
                ))
              )}
              {isActive && session.meetingInterim && (
                <div className="transcript-line active opacity-70">
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                  <span className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>Reunión:</span>
                  <span className="text-sm italic break-words min-w-0" style={{ color: '#67E8F9' }}>{interimTranslation ?? '…'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Columna Copiloto: solo respuestas en inglés cuando hay que contestar */}
        <div className={`${translator.enabled ? 'w-80' : 'w-96'} flex-shrink-0 flex flex-col`} style={{ background: 'var(--color-bg-card)' }}>
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
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgb(99 102 241/0.15)', color: '#818CF8' }}>EN</span>
            </div>
            {session.answers.length > 0 && (
              <button onClick={session.clearAnswers} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Limpiar
              </button>
            )}
          </div>

          <div ref={answersRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {session.answers.length === 0 && !session.nameHeard && (
              <p className="text-center py-8 px-4 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {isActive
                  ? <>Contesto en inglés cuando alguien diga <strong className="text-white">«{COPILOT_NAME}»</strong> o cuando presiones <strong className="text-white">Responder</strong>.</>
                  : 'Inicia la sesión para usar el Copiloto.'}
              </p>
            )}
            {session.answers.map(a => <AnswerCard key={a.id} answer={a} />)}
            {session.nameHeard && (
              <div className="p-3 rounded-lg text-xs flex items-center gap-2 animate-pulse"
                style={{ background: 'rgb(245 158 11/0.1)', border: '1px solid rgb(245 158 11/0.3)', color: '#FBBF24' }}>
                🔔 Te nombraron · esperando la pregunta…
              </div>
            )}
          </div>

          {isActive && (
            <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--color-surface-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Pregúntale al Copiloto (responde en inglés)</p>
              <div className="flex gap-2">
                <input type="text" value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAsk()}
                  placeholder="¿Cómo respondo a esto?"
                  className="flex-1 text-xs px-3 py-2 rounded-lg bg-transparent border text-white"
                  style={{ borderColor: 'var(--color-surface-border)' }} />
                <button onClick={handleAsk} disabled={copilotBusy}
                  className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6366F1, #4F46E5)', color: 'white' }}>
                  {copilotBusy ? '...' : 'Ask'}
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
          <div className="flex flex-col items-center gap-3 w-full max-w-2xl">
            <div className="w-full p-4 rounded-xl border space-y-2"
              style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
              <p className="font-semibold text-white flex items-center gap-2">🎧 Reunión en Vivo</p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Transcribe la reunión completa: el <strong>audio de los participantes</strong> (en blanco) y <strong>tu voz</strong> (en azul), en tiempo real.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Al iniciar, en el diálogo del navegador elige la <strong>Pestaña</strong> (Teams/Zoom/Meet Web) o <strong>Toda la pantalla</strong> (apps de escritorio) y marca ✓ <strong>Compartir audio</strong>.
              </p>
              {docCount > 0 && (
                <p className="text-xs" style={{ color: '#818CF8' }}>
                  📄 {docCount} documento{docCount > 1 ? 's' : ''} de contexto — el Copiloto los usará para responder.
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Idioma de tu voz:</span>
                {VOICE_LANGS.map(l => (
                  <button key={l.code} onClick={() => chooseVoiceLang(l.code)}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                    style={{
                      background: voiceLang === l.code ? 'rgba(99,102,241,0.2)' : 'var(--color-surface)',
                      border: `1px solid ${voiceLang === l.code ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
                      color: voiceLang === l.code ? '#818CF8' : 'var(--color-text)',
                    }}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => session.startSession(voiceLang)} className="btn-primary flex items-center gap-2 px-8 py-3">
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Iniciar Reunión en Vivo
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
            <button onClick={() => session.askCopilot()} disabled={copilotBusy}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, rgb(99 102 241/0.2), rgb(168 85 247/0.2))', border: '1px solid rgb(99 102 241/0.4)', color: '#818CF8' }}>
              💬 Responder
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
            <Link href="/meetings" className="btn-primary text-sm px-5 py-2">Ver en Reuniones</Link>
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
                <p key={i} className={log.includes('ERROR') ? 'text-red-400' : ''}>{log}</p>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
