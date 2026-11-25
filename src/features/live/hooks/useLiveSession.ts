'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { COPILOT_NAME, NAME_PATTERN } from '../copilot/profile'
import { startChunkedEngine } from '../engines/chunkedEngine'
import { startStreamEngine } from '../engines/streamEngine'
import type { EngineCallbacks, EngineKind, EngineStatus, LivePreview, MeetingEngine } from '../engines/types'
import {
  streamAnswer, researchAnswer, researchContext, researchQuery, copilotErrorText, CopilotError,
  type CopilotAnswer, type CopilotTrigger, type CopilotLang,
} from '../copilot/streamAnswer'
import { after } from '../utils/ticker'
import { startPerfMonitor } from '../diag/perfMonitor'
import { recordingBacklogBytes, setLiveActive } from '@/features/recording/store/recordingStore'

export type { CopilotAnswer, CopilotLang }

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
// La vista previa (palabras que aún pueden cambiar) se pinta como máximo 10 veces por segundo: antes
// cada mensaje de Soniox redibujaba toda la pantalla (PRP-005, fase 3).
const UI_FLUSH_MS           = 100
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
  const [engineStatus,   setEngineStatus]   = useState<EngineStatus>('ok') // reconectando / sin audio: aviso en pantalla
  // Traducción que llega junto con la transcripción (motor stream); en chunked la hace useLiveTranslation.
  const [segmentTranslations, setSegmentTranslations] = useState<Record<string, string>>({})
  const [liveTranslation, setLiveTranslation] = useState<LivePreview | null>(null)
  const [meetingContext, setMeetingContext] = useState<MeetingContextInfo | null>(null)
  const [nameHeard,      setNameHeard]      = useState(false)   // te nombraron; esperando la pregunta
  const [debugLogs,      setDebugLogs]      = useState<string[]>([])
  const [audioTracksOk,  setAudioTracksOk]  = useState(false)
  // Idioma de las respuestas del Copiloto, solo para esta pantalla (PRP-005, decisión 4b). Inglés por defecto.
  const [copilotLang,    setCopilotLangState] = useState<CopilotLang>('en')
  const [contextBusy,    setContextBusy]    = useState(false)   // «Investigar» libre en curso

  const meetingIdRef      = useRef<string | null>(null)
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null)
  const perfStopRef       = useRef<(() => void) | null>(null)  // monitor de rendimiento (diagnóstico cada minuto)
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
  const nameTimerRef      = useRef<(() => void) | null>(null)  // cancela la espera de 8 s (reloj del Worker)
  const copilotLangRef    = useRef<CopilotLang>('en')
  const contextBusyRef    = useRef(false)
  const uiPendingRef      = useRef<{ interim?: string; tentative?: string; translation?: LivePreview | null } | null>(null)
  const uiTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uiSyncRef         = useRef(false)                      // tras cerrar un fragmento, la vista previa se limpia al momento
  const lastNameAnswerRef = useRef(0)
  const copilotBusyRef    = useRef(false)

  function addLog(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    console.log('[LiveSession]', msg)
    setDebugLogs(prev => [...prev.slice(-49), entry])
  }

  /** Memoria que usa la página (solo Chrome/Edge la reportan), en MB. */
  function heapMb(): number | null {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
  }

  /** Evento de diagnóstico guardado con la reunión: si algo se traba, se sabe si fue la conexión, el audio o la memoria. */
  function sendDiag(event: string, data: Record<string, unknown> = {}) {
    const id = meetingIdRef.current
    if (!id) return
    void fetch(`/api/meetings/${id}/diag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ event, at: new Date().toISOString(), data: { ...data, heapMb: heapMb(), segments: transcriptRef.current.length } }),
    }).catch(() => {})
  }

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false
      recognitionRef.current?.abort()
      stopAllStreams()
      if (timerRef.current)     clearInterval(timerRef.current)
      perfStopRef.current?.()
      nameTimerRef.current?.()
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current)
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
      const text = await streamAnswer(meetingIdRef.current, { question, live: liveForCopilot(), trigger, answerLang: copilotLangRef.current }, t => update({ text: t }))
      update({ text: text || 'No answer was generated.', status: 'done' })
    } catch (err) {
      addLog(`Copiloto: ${err instanceof Error ? err.message : String(err)}`)
      update({ text: copilotErrorText(err), status: 'error' })
    } finally {
      copilotBusyRef.current = false
    }
  }

  function armName() {
    nameArmedRef.current = Date.now()
    setNameHeard(true)
    nameTimerRef.current?.()
    // Reloj del Worker: con la pestaña tapada, setTimeout de 8 s podía tardar hasta un minuto.
    nameTimerRef.current = after(NAME_FALLBACK_MS, fireName)
  }

  function fireName() {
    if (nameArmedRef.current === null) return
    nameArmedRef.current = null
    nameTimerRef.current?.()
    nameTimerRef.current = null
    setNameHeard(false)
    lastNameAnswerRef.current = Date.now()
    const question = `${turnTextRef.current} ${meetingBufferRef.current}`.trim().slice(-800)
    addLog(`Copiloto: te nombraron → "${question.slice(0, 80)}"`)
    void runCopilot('name', question)
  }

  // ─────────────────────────────────────────────────────────
  // Audio de la reunión → motor de transcripción → vista previa + historial
  // ─────────────────────────────────────────────────────────
  /** Pinta la vista previa: al momento justo después de cerrar un fragmento; si no, máx. 10 veces por segundo. */
  function queuePreview(patch: { interim?: string; tentative?: string; translation?: LivePreview | null }) {
    uiPendingRef.current = { ...uiPendingRef.current, ...patch }
    if (uiSyncRef.current) { flushPreview(); return }
    if (!uiTimerRef.current) uiTimerRef.current = setTimeout(flushPreview, UI_FLUSH_MS)
  }

  function flushPreview() {
    if (uiTimerRef.current) { clearTimeout(uiTimerRef.current); uiTimerRef.current = null }
    const p = uiPendingRef.current
    uiPendingRef.current = null
    if (!p) return
    if (p.interim !== undefined) setMeetingInterim(p.interim)
    if (p.tentative !== undefined) setMeetingTentative(p.tentative)
    if (p.translation !== undefined) setLiveTranslation(p.translation)
  }

  /** Borra la vista previa al momento (al terminar o reiniciar la sesión). */
  function clearPreview() {
    uiPendingRef.current = { interim: '', tentative: '', translation: null }
    flushPreview()
  }

  const engineCallbacks: EngineCallbacks = {
    preview(p) {
      // El texto para el Copiloto se actualiza siempre al momento; solo la pantalla espera.
      meetingBufferRef.current = `${p.text} ${p.tentative.replace(/…/g, ' ')}`.replace(/\s+/g, ' ').trim()
      queuePreview({ interim: p.text, tentative: p.tentative })
    },
    translationPreview(p) { queuePreview({ translation: p.text || p.tentative ? p : null }) },
    commit(text, translation) {
      turnTextRef.current = `${turnTextRef.current} ${text}`.trim()
      // Lo que sigue en este mismo mensaje (vista previa sin el texto cerrado) se pinta junto con el fragmento.
      uiSyncRef.current = true
      queueMicrotask(() => { uiSyncRef.current = false })
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
      // Solo se anota cuando aparece tu nombre: anotar cada frase redibujaba la pantalla una vez más.
      if (!NAME_PATTERN.test(text)) return
      addLog(`Reunión: "${text.slice(0, 80)}"`)
      if (nameArmedRef.current === null && Date.now() - lastNameAnswerRef.current > NAME_COOLDOWN_MS) armName()
    },
    log: addLog,
    status: setEngineStatus,
    diag: sendDiag,
  }

  async function fallBackToChunked(tracks: MediaStream, reason: string) {
    if (!shouldRestartRef.current) return
    addLog(`Streaming falló (${reason}): sigo con la transcripción por tramos`)
    sendDiag('fallback-chunked', { reason })
    setEngineStatus('ok')
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
    // Si la pista de audio se corta sola (p. ej. se cerró la pestaña compartida), queda anotado.
    audioTracks.forEach(t => t.addEventListener('ended', () => {
      addLog('Reunión: la pista de audio compartida terminó')
      sendDiag('audio-track-ended')
    }))
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
  const startSession = useCallback(async (voiceLang = 'en-US', translateTo: string | null = 'es', title = '') => {
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
        // Con el cliente en el título, el Copiloto elige su entrada en documentos con varios clientes.
        body: JSON.stringify(title.trim() ? { title: title.trim().slice(0, 120) } : {}),
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
      setLiveActive(true) // la Grabación baja a 8 fps mientras corre IA en Vivo

      // Desde la hora de inicio: con la pestaña tapada el reloj se frena y sumar 1 por tic se atrasaba.
      timerRef.current = setInterval(() => setDuration(Math.floor((Date.now() - sessionStartRef.current) / 1000)), DURATION_TICK_MS)
      perfStopRef.current = startPerfMonitor({
        send: (event, data) => sendDiag(event, data),
        engineStats: () => engineRef.current?.stats?.(),
        recordingBacklogBytes,
        displaySurface: () => {
          const settings = displayStreamRef.current?.getVideoTracks()[0]?.getSettings() as (MediaTrackSettings & { displaySurface?: string }) | undefined
          return settings?.displaySurface ?? null
        },
      })
      setStatus('active')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar'
      addLog(`ERROR: ${msg}`)
      setError(msg)
      setStatus('error')
      shouldRestartRef.current = false
      try { recognitionRef.current?.abort() } catch { /**/ }
      stopAllStreams()
      setLiveActive(false)
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
    nameTimerRef.current?.()
    nameTimerRef.current = null
    nameArmedRef.current = null
    setNameHeard(false)
    setLiveActive(false)
    setIsListening(false)
    setInterimText('')
    engineCallbacks.preview(EMPTY_PREVIEW)
    clearPreview()
    setEngineStatus('ok')
    if (timerRef.current) clearInterval(timerRef.current)
    perfStopRef.current?.()
    perfStopRef.current = null

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

  /** «Investigar» (PRP-004): verifica en internet una respuesta, con la pregunta y lo último de la reunión. */
  const researchCopilot = useCallback(async (answer: CopilotAnswer) => {
    const update = (research: CopilotAnswer['research']) => setAnswers(prev => prev.map(a => (a.id === answer.id ? { ...a, research } : a)))
    if (!meetingIdRef.current) { update({ status: 'error', error: 'La reunión ya terminó: no se puede investigar.' }); return }
    update({ status: 'loading' })
    try {
      const r = await researchAnswer(meetingIdRef.current, { question: answer.question ?? undefined, answer: answer.text, live: liveForCopilot() })
      update({ status: 'done', ...r })
      addLog(`Investigar: «${r.query ?? ''}» (${r.ms ?? '?'} ms)`)
    } catch (err) {
      addLog(`Investigar: ${err instanceof Error ? err.message : String(err)}`)
      update({ status: 'error', error: err instanceof CopilotError && err.forUser ? err.message : 'No se pudo buscar en internet. Intenta de nuevo.' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * «Investigar» libre (PRP-005): sin pregunta. Primero los últimos puntos de la reunión en el idioma que
   * se habla (sin internet, ~1-2 s) y después la búsqueda de su tema técnico, contestada en ese idioma.
   */
  const investigateContext = useCallback(async () => {
    const meetingId = meetingIdRef.current
    if (!meetingId || contextBusyRef.current) return
    if (!transcriptRef.current.length && !meetingBufferRef.current.trim()) {
      setError('Todavía no hay conversación que investigar.')
      setTimeout(() => setError(null), 3000)
      return
    }
    contextBusyRef.current = true
    setContextBusy(true)
    const id = crypto.randomUUID()
    const update = (patch: Partial<CopilotAnswer>) => setAnswers(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)))
    setAnswers(prev => [...prev, { id, trigger: 'context', question: null, text: '', status: 'streaming' }])
    try {
      const c = await researchContext(meetingId, liveForCopilot())
      update({
        status: 'done', points: c.points, text: c.points.join('\n'),
        research: c.query ? { status: 'loading' } : { status: 'error', error: 'No había un tema técnico que buscar en internet: arriba tienes los últimos puntos.' },
      })
      addLog(`Investigar libre: ${c.points.length} puntos (${c.language})${c.query ? ` · «${c.query}»` : ''}`)
      if (c.query) {
        try {
          const r = await researchQuery(meetingId, c.query, c.language)
          update({ research: { status: 'done', ...r } })
        } catch (err) {
          update({ research: { status: 'error', error: err instanceof CopilotError && err.forUser ? err.message : 'No se pudo buscar en internet. Intenta de nuevo.' } })
        }
      }
    } catch (err) {
      addLog(`Investigar libre: ${err instanceof Error ? err.message : String(err)}`)
      update({ status: 'error', text: err instanceof CopilotError && err.forUser ? err.message : 'No se pudo investigar. Intenta de nuevo.' })
    } finally {
      contextBusyRef.current = false
      setContextBusy(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Idioma de la traducción a media reunión (solo para esta reunión, decisión 3b). Misma reunión, mismo motor. */
  const setTranslationLang = useCallback((lang: string) => {
    if (translateToRef.current === lang) return
    translateToRef.current = lang
    engineRef.current?.setTranslateTo?.(lang)
    addLog(`Traducción: ahora a ${lang}`)
    sendDiag('translate-lang', { lang })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** «Idioma de tu voz» a media reunión: reinicia solo el reconocimiento de tu micrófono. */
  const setVoiceLang = useCallback((lang: string) => {
    const old = recognitionRef.current
    if (!old || !shouldRestartRef.current) return
    let launched = false
    const launch = () => {
      if (launched || !shouldRestartRef.current) return
      launched = true
      launchSpeechRecognition(lang)
    }
    old.onresult = null
    old.onend = launch // el nuevo arranca cuando el anterior terminó de cerrarse
    setInterimText('')
    try { old.abort() } catch { launch() }
    after(1500, launch)
    addLog(`Tu voz: ahora en ${lang}`)
    sendDiag('voice-lang', { lang })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Idioma de las respuestas del Copiloto (decisión 4b); aplica desde la siguiente respuesta. */
  const setCopilotLang = useCallback((lang: CopilotLang) => {
    copilotLangRef.current = lang
    setCopilotLangState(lang)
  }, [])

  const clearAnswers = useCallback(() => setAnswers([]), [])

  const resetSession = useCallback(() => {
    clearPreview()
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
    engineKind, engineStatus, segmentTranslations, liveTranslation, meetingContext, copilotLang, contextBusy,
    startSession, endSession, askCopilot, researchCopilot, clearAnswers, resetSession,
    investigateContext, setTranslationLang, setVoiceLang, setCopilotLang,
  }
}
