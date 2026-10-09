'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeWav, OrderedDelivery, SpeechSegmenter, startMeetingAudioTap, type MeetingAudioTap } from '../audio/meetingAudio'
import { COPILOT_NAME, NAME_PATTERN } from '../copilot/profile'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionCtor | undefined
    webkitSpeechRecognition: SpeechRecognitionCtor | undefined
  }
}

const DURATION_TICK_MS      = 1000
// El turno de la reunión se vuelca al historial al terminar de hablar (pausa de
// 1.2 s, la detecta meetingAudio) o al llegar a este largo, para fragmentos legibles.
const MEETING_FLUSH_CHARS   = 220
// Cuando dicen tu nombre, el Copiloto espera a que terminen la pregunta (fin de
// turno); si siguen hablando, contesta a los 8 s con lo que lleven.
const NAME_FALLBACK_MS      = 8000
const NAME_COOLDOWN_MS      = 15000
const COPILOT_CONTEXT_CHARS = 6000
const END_WAIT_MS           = 4000 // al finalizar, espera las últimas transcripciones en camino

type Delivered = { kind: 'text'; text: string } | { kind: 'turnEnd' }

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
  const [meetingInterim, setMeetingInterim] = useState('')      // audio de reunión (blanco)
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
  const tapRef            = useRef<MeetingAudioTap | null>(null)
  const deliveryRef       = useRef<OrderedDelivery<Delivered> | null>(null)
  const inFlightRef       = useRef(0)
  const meetingBufferRef  = useRef<string>('')                 // texto del turno aún sin volcar
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
    tapRef.current?.stop()
    tapRef.current = null
    displayStreamRef.current?.getTracks().forEach(t => t.stop())
    displayStreamRef.current = null
  }

  async function saveSegment(text: string) {
    if (!meetingIdRef.current) return
    const now = Date.now() - sessionStartRef.current
    await fetch(`/api/meetings/${meetingIdRef.current}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_ms: Math.max(0, now - 2000), end_ms: now, text, language: 'es' }),
    }).catch(() => {})
  }

  function addSegment(text: string, speaker: 'me' | 'meeting') {
    const startMs = Date.now() - sessionStartRef.current
    const seg: TranscriptSegment = { id: crypto.randomUUID(), text, start_ms: startMs, end_ms: startMs + 500, speaker }
    transcriptRef.current = [...transcriptRef.current, seg]
    setTranscript(transcriptRef.current)
    wordCountRef.current += text.split(/\s+/).length
    setWordCount(wordCountRef.current)
    saveSegment(text)
  }

  // ─────────────────────────────────────────────────────────
  // Copiloto: solo contesta cuando hay que contestar (botón, tu nombre o tu pregunta escrita)
  // ─────────────────────────────────────────────────────────
  function conversationForCopilot(): string {
    const lines = transcriptRef.current.slice(-60)
      .map(s => `${s.speaker === 'me' ? COPILOT_NAME : 'Meeting'}: ${s.text}`)
    if (meetingBufferRef.current.trim()) lines.push(`Meeting: ${meetingBufferRef.current.trim()}`)
    return lines.join('\n').slice(-COPILOT_CONTEXT_CHARS)
  }

  async function runCopilot(trigger: CopilotTrigger, question?: string) {
    if (!meetingIdRef.current) return
    if (copilotBusyRef.current && trigger === 'name') return
    copilotBusyRef.current = true
    const id = crypto.randomUUID()
    const update = (patch: Partial<CopilotAnswer>) => setAnswers(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)))
    setAnswers(prev => [...prev, { id, trigger, question: question?.trim() || null, text: '', status: 'streaming' }])
    try {
      const text = await streamAnswer(meetingIdRef.current, { question, transcript: conversationForCopilot(), trigger }, t => update({ text: t }))
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
  // Audio de la reunión → transcripción (en orden) → preview + historial
  // ─────────────────────────────────────────────────────────
  function flushMeetingBuffer() {
    const t = meetingBufferRef.current.trim()
    meetingBufferRef.current = ''
    setMeetingInterim('')
    if (t.length > 1) {
      turnTextRef.current = `${turnTextRef.current} ${t}`.trim()
      addSegment(t, 'meeting')
    }
  }

  function handleDelivered(d: Delivered) {
    if (d.kind === 'turnEnd') {
      flushMeetingBuffer()
      if (nameArmedRef.current !== null) fireName()
      turnTextRef.current = ''
      return
    }
    if (!d.text) return
    meetingBufferRef.current = `${meetingBufferRef.current} ${d.text}`.trim()
    setMeetingInterim(meetingBufferRef.current)
    addLog(`Reunión: "${d.text.slice(0, 80)}"`)
    if (NAME_PATTERN.test(d.text) && nameArmedRef.current === null && Date.now() - lastNameAnswerRef.current > NAME_COOLDOWN_MS) armName()
    if (meetingBufferRef.current.length >= MEETING_FLUSH_CHARS) flushMeetingBuffer()
  }

  async function transcribeChunk(pcm: Float32Array) {
    const delivery = deliveryRef.current
    if (!delivery) return
    const seq = delivery.ticket()
    let text = ''
    inFlightRef.current++
    try {
      const res = await fetch('/api/live/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(pcm) })
      if (res.ok) text = String((await res.json()).text ?? '').trim()
      else addLog(`API ${res.status}`)
    } catch (err) {
      addLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      inFlightRef.current--
    }
    delivery.resolve(seq, { kind: 'text', text: text.length > 1 ? text : '' })
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

    const delivery = new OrderedDelivery<Delivered>(handleDelivered)
    deliveryRef.current = delivery
    const segmenter = new SpeechSegmenter(
      pcm => { void transcribeChunk(pcm) },
      () => delivery.resolve(delivery.ticket(), { kind: 'turnEnd' }),
    )
    tapRef.current = await startMeetingAudioTap(new MediaStream(audioTracks), segmenter)
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
  const startSession = useCallback(async (voiceLang = 'en-US') => {
    setStatus('starting')
    setError(null)
    setTranscript([])
    setAnswers([])
    setWordCount(0)
    setDuration(0)
    setAudioTracksOk(false)
    setMeetingInterim('')
    setNameHeard(false)
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
    stopAllStreams() // manda el último tramo de audio pendiente
    const deadline = Date.now() + END_WAIT_MS
    while (inFlightRef.current > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
    flushMeetingBuffer()
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameArmedRef.current = null
    setNameHeard(false)
    setIsListening(false)
    setInterimText('')
    setMeetingInterim('')
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
    setAudioTracksOk(false); setNameHeard(false)
    transcriptRef.current    = []
    wordCountRef.current     = 0
    meetingBufferRef.current = ''
    turnTextRef.current      = ''
  }, [])

  return {
    status, meetingId, transcript, answers, wordCount, duration, nameHeard,
    error, isListening, interimText, meetingInterim, audioTracksOk, debugLogs,
    startSession, endSession, askCopilot, clearAnswers, resetSession,
  }
}
