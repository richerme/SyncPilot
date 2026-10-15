'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { COPILOT_NAME, NAME_PATTERN } from '../copilot/profile'
import { startChunkedEngine } from '../engines/chunkedEngine'
import { startStreamEngine } from '../engines/streamEngine'
import type { EngineCallbacks, EngineKind, LivePreview, MeetingEngine } from '../engines/types'
import { streamAnswer, type CopilotAnswer, type CopilotTrigger } from '../copilot/streamAnswer'

export type { CopilotAnswer }

export interface TranscriptSegment {
  id: string
  text: string
  start_ms: number
  end_ms: number
  speaker: 'me' | 'meeting' | null
}

export type LiveStatus = 'idle' | 'starting' | 'active' | 'ending' | 'done' | 'error'

/** Contexto de la reunión armado con los documentos activos (ver lib/meetingContext). */
export interface MeetingContextInfo {
  status: 'loading' | 'ready' | 'error'
  docs: { name: string; chars: number }[]
  brief: string
  terms: string[]
  cached: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionCtor | undefined
    webkitSpeechRecognition: SpeechRecognitionCtor | undefined
  }
}

const DURATION_TICK_MS      = 1000
// Cuando dicen tu nombre, el Copiloto espera a que terminen la pregunta (fin de
// turno); si siguen hablando, contesta a los 8 s con lo que lleven.
const NAME_FALLBACK_MS      = 8000
const NAME_COOLDOWN_MS      = 15000
const EMPTY_PREVIEW: LivePreview = { text: '', tentative: '' }

export function useLiveSession() {
  const [status,         setStatus]         = useState<LiveStatus>('idle')
  const [meetingId,      setMeetingId]      = useState<string | null>(null)
  const [transcript,     setTranscript]     = useState<TranscriptSegment[]>([])
  const [answers,        setAnswers]        = useState<CopilotAnswer[]>([])
  const [wordCount,      setWordCount]      = useState(0)
  const [duration,       setDuration]       = useState(0)
  const [error,          setError]          = useState<string | null>(null)
  const [isListening,    setIsListening]    = useState(false)
  const [interimText,    setInterimText]    = useState('')      // voz del usuario (azul)
  const [meetingInterim, setMeetingInterim] = useState('')      // audio de reunión (blanco): ya reconocido
  const [meetingTentative, setMeetingTentative] = useState('')  // lo que aún puede cambiar o tramos en camino
  const [engineKind,     setEngineKind]     = useState<EngineKind | null>(null)
  // Traducción que llega junto con la transcripción (motor stream); en chunked la hace useLiveTranslation.
  const [segmentTranslations, setSegmentTranslations] = useState<Record<string, string>>({})
  const [liveTranslation, setLiveTranslation] = useState<LivePreview | null>(null)
  const [meetingContext, setMeetingContext] = useState<MeetingContextInfo | null>(null)
  const [nameHeard,      setNameHeard]      = useState(false)   // te nombraron; esperando la pregunta
  const [debugLogs,      setDebugLogs]      = useState<string[]>([])
  const [audioTracksOk,  setAudioTracksOk]  = useState(false)

  const meetingIdRef      = useRef<string | null>(null)
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionStartRef   = useRef<number>(0)
  const transcriptRef     = useRef<TranscriptSegment[]>([])
  const wordCountRef      = useRef(0)
  const shouldRestartRef  = useRef<boolean>(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef    = useRef<any>(null)
  const displayStreamRef  = useRef<MediaStream | null>(null)   // pestaña/pantalla (getDisplayMedia)
  const engineRef         = useRef<MeetingEngine | null>(null)
  const meetingBufferRef  = useRef<string>('')                 // texto del turno aún sin volcar
  const unsavedRef        = useRef(new Map<string, TranscriptSegment>()) // fragmentos que aún no confirma el servidor
  const contextTermsRef   = useRef<Promise<string[]> | null>(null)        // términos de los documentos (para el streaming)
  const translateToRef    = useRef<string | null>('es')
  const turnTextRef       = useRef<string>('')                 // todo lo dicho en el turno actual
  const nameArmedRef      = useRef<number | null>(null)
  const nameTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNameAnswerRef = useRef(0)
  const copilotBusyRef    = useRef(false)

  function addLog(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    console.log('[LiveSession]', msg)
    setDebugLogs(prev => [...prev.slice(-49), entry])
  }

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false
      recognitionRef.current?.abort()
      stopAllStreams()
      if (timerRef.current)     clearInterval(timerRef.current)
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopAllStreams() {
    void engineRef.current?.stop()
    engineRef.current = null
    displayStreamRef.current?.getTracks().forEach(t => t.stop())
    displayStreamRef.current = null
  }

  async function saveSegment(seg: TranscriptSegment) {
    if (!meetingIdRef.current) return
    unsavedRef.current.set(seg.id, seg)
    const now = Date.now() - sessionStartRef.current
    const res = await fetch(`/api/meetings/${meetingIdRef.current}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_ms: Math.max(0, now - 2000), end_ms: now, text: seg.text, language: 'es', speaker: seg.speaker ?? 'meeting' }),
    }).catch(() => null)
    if (res?.ok) unsavedRef.current.delete(seg.id)
  }

  function addSegment(text: string, speaker: 'me' | 'meeting', translation?: string) {
    const startMs = Date.now() - sessionStartRef.current
    const seg: TranscriptSegment = { id: crypto.randomUUID(), text, start_ms: startMs, end_ms: startMs + 500, speaker }
    if (translation) setSegmentTranslations(prev => ({ ...prev, [seg.id]: translation }))
    transcriptRef.current = [...transcriptRef.current, seg]
    setTranscript(transcriptRef.current)
    wordCountRef.current += text.split(/\s+/).length
    setWordCount(wordCountRef.current)
    void saveSegment(seg)
  }

  // ─────────────────────────────────────────────────────────
  // Copiloto: solo contesta cuando hay que contestar (botón, tu nombre o tu pregunta escrita)
  // ─────────────────────────────────────────────────────────
  // El servidor lee toda la reunión guardada; aquí solo va lo que aún no confirma y el turno en curso.
  function liveForCopilot(): string {
    const mmss = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor((ms % 60000) / 1000).toString().padStart(2, '0')}`
    const lines = [...unsavedRef.current.values()]
      .sort((a, b) => a.start_ms - b.start_ms)
      .map(s => `[${mmss(s.start_ms)}] ${s.speaker === 'me' ? COPILOT_NAME : 'Meeting'}: ${s.text}`)
    if (meetingBufferRef.current.trim()) lines.push(`[${mmss(Date.now() - sessionStartRef.current)}] Meeting: ${meetingBufferRef.current.trim()}`)
    return lines.join('\n').slice(-20000)
  }

  async function loadMeetingContext(meetingId: string): Promise<string[]> {
    setMeetingContext({ status: 'loading', docs: [], brief: '', terms: [], cached: false })
    try {
      const res = await fetch(`/api/meetings/${meetingId}/context`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (meetingIdRef.current !== meetingId) return []
      setMeetingContext({ status: 'ready', docs: data.docs ?? [], brief: data.brief ?? '', terms: data.terms ?? [], cached: !!data.cached })
      addLog(`Contexto: ${data.docs?.length ?? 0} documentos${data.cached ? ' en caché' : ''}`)
      return Array.isArray(data.terms) ? data.terms : []
    } catch (err) {
      addLog(`Contexto: ${err instanceof Error ? err.message : String(err)}`)
      if (meetingIdRef.current === meetingId) setMeetingContext(prev => prev && { ...prev, status: 'error' })
      return []
    }
  }

  async function runCopilot(trigger: CopilotTrigger, question?: string) {
    if (!meetingIdRef.current) return
    if (copilotBusyRef.current && trigger === 'name') return
    copilotBusyRef.current = true
    const id = crypto.randomUUID()
    const update = (patch: Partial<CopilotAnswer>) => setAnswers(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)))
    setAnswers(prev => [...prev, { id, trigger, question: question?.trim() || null, text: '', status: 'streaming' }])
    try {
      const text = await streamAnswer(meetingIdRef.current, { question, live: liveForCopilot(), trigger }, t => update({ text: t }))
      update({ text: text || 'No answer was generated.', status: 'done' })
    } catch (err) {
      addLog(`Copiloto: ${err instanceof Error ? err.message : String(err)}`)
      update({ text: 'No se pudo generar la respuesta. Intenta de nuevo.', status: 'error' })
    } finally {
      copilotBusyRef.current = false
    }
  }

  function armName() {
    nameArmedRef.current = Date.now()
    setNameHeard(true)
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(fireName, NAME_FALLBACK_MS)
  }

  function fireName() {
    if (nameArmedRef.current === null) return
    nameArmedRef.current = null
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    setNameHeard(false)
    lastNameAnswerRef.current = Date.now()
    const question = `${turnTextRef.current} ${meetingBufferRef.current}`.trim().slice(-800)
    addLog(`Copiloto: te nombraron → "${question.slice(0, 80)}"`)
    void runCopilot('name', question)
  }

  // ─────────────────────────────────────────────────────────
  // Audio de la reunión → motor de transcripción → vista previa + historial
  // ─────────────────────────────────────────────────────────
  const engineCallbacks: EngineCallbacks = {
    preview(p) {
      meetingBufferRef.current = `${p.text} ${p.tentative.replace(/…/g, ' ')}`.replace(/\s+/g, ' ').trim()
      setMeetingInterim(p.text)
      setMeetingTentative(p.tentative)
    },
    translationPreview(p) { setLiveTranslation(p.text || p.tentative ? p : null) },
    commit(text, translation) {
      turnTextRef.current = `${turnTextRef.current} ${text}`.trim()
      addSegment(text, 'meeting', translation)
    },
    amendTranslation(text) {
      const last = [...transcriptRef.current].reverse().find(seg => seg.speaker === 'meeting')
      if (last) setSegmentTranslations(prev => ({ ...prev, [last.id]: `${prev[last.id] ?? ''}${text}`.trim() }))
    },
    turnEnd() {
      if (nameArmedRef.current !== null) fireName()
      turnTextRef.current = ''
    },
    heard(text) {
      addLog(`Reunión: "${text.slice(0, 80)}"`)
      if (NAME_PATTERN.test(text) && nameArmedRef.current === null && Date.now() - lastNameAnswerRef.current > NAME_COOLDOWN_MS) armName()
    },
    log: addLog,
  }

  async function fallBackToChunked(tracks: MediaStream, reason: string) {
    if (!shouldRestartRef.current) return
    addLog(`Streaming falló (${reason}): sigo con la transcripción por tramos`)
    engineRef.current = await startChunkedEngine(tracks, engineCallbacks)
    setEngineKind('chunked')
  }

  async function launchMeetingCapture() {
    addLog('Reunión: solicitando getDisplayMedia...')
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    } as DisplayMediaStreamOptions)

    const audioTracks = displayStream.getAudioTracks()
    addLog(`Reunión: audioTracks=${audioTracks.length}, videoTracks=${displayStream.getVideoTracks().length}`)
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach(t => t.stop())
      throw new Error('No se encontró audio compartido. Selecciona "Pestaña" o "Toda la pantalla" y marca ✓ "Compartir audio".')
    }
    displayStreamRef.current = displayStream
    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (shouldRestartRef.current) {
        setError('Compartir pantalla detenido.')
        shouldRestartRef.current = false
        setIsListening(false)
      }
    })

    // Streaming (palabra por palabra + traducción a la par) si está configurado; si no, o si
    // falla, la transcripción por tramos.
    const tracks = new MediaStream(audioTracks)
    try {
      engineRef.current = await startStreamEngine(tracks, engineCallbacks, {
        meetingId: meetingIdRef.current ?? '',
        translateTo: translateToRef.current,
        terms: () => contextTermsRef.current ?? Promise.resolve([]),
        onFail: reason => { void fallBackToChunked(tracks, reason) },
      })
    } catch (err) {
      addLog(`Streaming no disponible (${err instanceof Error ? err.message : String(err)}): transcripción por tramos`)
      engineRef.current = await startChunkedEngine(tracks, engineCallbacks)
    }
    setEngineKind(engineRef.current.kind)
    setAudioTracksOk(true)
    setIsListening(true)
  }

  // ─────────────────────────────────────────────────────────
  // SpeechRecognition: voz del usuario (azul, instantáneo)
  // ─────────────────────────────────────────────────────────
  function launchSpeechRecognition(lang: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Cls = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Cls) { addLog('SpeechRecognition: no soportado'); return }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new Cls()
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = lang

    rec.onresult = (event: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (event as any).results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idx = (event as any).resultIndex ?? 0
      let interim = ''
      for (let i = idx; i < results.length; i++) {
        if (results[i].isFinal) {
          const text = results[i][0].transcript.trim()
          if (text && text.length > 1) addSegment(text, 'me')
        } else {
          interim += results[i][0].transcript
        }
      }
      setInterimText(interim)
    }

    rec.onend = () => {
      setInterimText('')
      if (shouldRestartRef.current) {
        try { rec.start() } catch { /**/ }
      }
    }

    rec.onerror = (event: Event & { error?: string }) => {
      if (event.error === 'not-allowed') try { rec.abort() } catch { /**/ }
    }

    recognitionRef.current = rec
    try { rec.start() } catch { /**/ }
  }

  // ─────────────────────────────────────────────────────────
  // Ciclo de vida
  // ─────────────────────────────────────────────────────────
  const startSession = useCallback(async (voiceLang = 'en-US', translateTo: string | null = 'es') => {
    translateToRef.current = translateTo
    setStatus('starting')
    setError(null)
    setTranscript([])
    setAnswers([])
    setWordCount(0)
    setDuration(0)
    setAudioTracksOk(false)
    setMeetingInterim('')
    setMeetingTentative('')
    setSegmentTranslations({})
    setLiveTranslation(null)
    setMeetingContext(null)
    setNameHeard(false)
    unsavedRef.current.clear()
    transcriptRef.current    = []
    wordCountRef.current     = 0
    meetingBufferRef.current = ''
    turnTextRef.current      = ''
    nameArmedRef.current     = null

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al crear sesión')

      meetingIdRef.current = data.meeting_id
      setMeetingId(data.meeting_id)
      // Documentos completos + de qué trata la reunión, sin detener el inicio.
      contextTermsRef.current = loadMeetingContext(data.meeting_id)
      sessionStartRef.current  = Date.now()
      shouldRestartRef.current = true

      // Voz del usuario (instantánea) + audio de la reunión (pestaña/pantalla)
      launchSpeechRecognition(voiceLang)
      await launchMeetingCapture()

      timerRef.current = setInterval(() => setDuration(d => d + 1), DURATION_TICK_MS)
      setStatus('active')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar'
      addLog(`ERROR: ${msg}`)
      setError(msg)
      setStatus('error')
      shouldRestartRef.current = false
      try { recognitionRef.current?.abort() } catch { /**/ }
      stopAllStreams()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endSession = useCallback(async () => {
    setStatus('ending')
    shouldRestartRef.current = false

    try { recognitionRef.current?.abort() } catch { /**/ }
    recognitionRef.current = null
    // El motor manda el último tramo, espera las respuestas en camino y vuelca el turno.
    await engineRef.current?.stop()
    engineRef.current = null
    displayStreamRef.current?.getTracks().forEach(t => t.stop())
    displayStreamRef.current = null
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameArmedRef.current = null
    setNameHeard(false)
    setIsListening(false)
    setInterimText('')
    engineCallbacks.preview(EMPTY_PREVIEW)
    setLiveTranslation(null)
    if (timerRef.current) clearInterval(timerRef.current)

    if (meetingIdRef.current) {
      await fetch(`/api/meetings/${meetingIdRef.current}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word_count: wordCountRef.current }),
      }).catch(() => {})
    }

    setStatus('done')
    setMeetingId(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Botón "Responder" (sin texto) o pregunta escrita por el usuario. */
  const askCopilot = useCallback(async (typed?: string) => {
    if (!meetingIdRef.current) return
    if (!typed?.trim() && !transcriptRef.current.length && !meetingBufferRef.current.trim()) {
      setError('Todavía no hay conversación que responder.')
      setTimeout(() => setError(null), 3000)
      return
    }
    await runCopilot(typed?.trim() ? 'typed' : 'button', typed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearAnswers = useCallback(() => setAnswers([]), [])

  const resetSession = useCallback(() => {
    setStatus('idle'); setMeetingId(null); setTranscript([]); setAnswers([])
    setWordCount(0); setDuration(0); setError(null); setInterimText(''); setMeetingInterim('')
    setMeetingTentative(''); setSegmentTranslations({}); setLiveTranslation(null); setEngineKind(null); setMeetingContext(null)
    setAudioTracksOk(false); setNameHeard(false)
    transcriptRef.current    = []
    wordCountRef.current     = 0
    meetingBufferRef.current = ''
    turnTextRef.current      = ''
  }, [])

  return {
    status, meetingId, transcript, answers, wordCount, duration, nameHeard,
    error, isListening, interimText, meetingInterim, meetingTentative, audioTracksOk, debugLogs,
    engineKind, segmentTranslations, liveTranslation, meetingContext,
    startSession, endSession, askCopilot, clearAnswers, resetSession,
  }
}
