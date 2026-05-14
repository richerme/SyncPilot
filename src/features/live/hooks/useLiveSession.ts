'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TranscriptSegment {
  id: string
  text: string
  start_ms: number
  end_ms: number
  speaker: 'me' | 'meeting' | null
}
export interface AiSuggestion {
  id?: string
  type: 'reply' | 'question' | 'info' | 'warning'
  text: string
}

export type LiveStatus = 'idle' | 'starting' | 'active' | 'ending' | 'done' | 'error'
export type AudioMode = 'mic' | 'tab' | 'both' | 'dual'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionCtor | undefined
    webkitSpeechRecognition: SpeechRecognitionCtor | undefined
  }
}

const SUGGEST_DEBOUNCE_MS = 3000
const DURATION_TICK_MS    = 1000
const CHUNK_MS            = 2000

const STORAGE_AUDIO_MODE   = 'syncpilot_audio_mode'
const STORAGE_USER_MIC     = 'syncpilot_user_mic'
const STORAGE_SYSTEM_MIC   = 'syncpilot_system_mic'

export function useLiveSession() {
  const [status,        setStatus]        = useState<LiveStatus>('idle')
  const [meetingId,     setMeetingId]     = useState<string | null>(null)
  const [transcript,    setTranscript]    = useState<TranscriptSegment[]>([])
  const [suggestions,   setSuggestions]   = useState<AiSuggestion[]>([])
  const [wordCount,     setWordCount]     = useState(0)
  const [duration,      setDuration]      = useState(0)
  const [error,         setError]         = useState<string | null>(null)
  const [isListening,   setIsListening]   = useState(false)
  const [interimText,   setInterimText]   = useState('')
  const [debugLogs,     setDebugLogs]     = useState<string[]>([])
  const [audioTracksOk, setAudioTracksOk] = useState(false)
  const [audioMode,     setAudioModeState] = useState<AudioMode>('both')
  const [userMicId,     setUserMicIdState]   = useState<string>('default')
  const [systemMicId,   setSystemMicIdState] = useState<string>('default')

  const meetingIdRef       = useRef<string | null>(null)
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null)
  const suggestTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionStartRef    = useRef<number>(0)
  const pendingTextRef     = useRef<string>('')
  const transcriptRef      = useRef<TranscriptSegment[]>([])
  const shouldRestartRef   = useRef<boolean>(false)
  const chunkActiveRef     = useRef<boolean>(false)
  const documentContextRef = useRef<string>('')
  const audioModeRef       = useRef<AudioMode>('both')
  const userMicIdRef       = useRef<string>('default')
  const systemMicIdRef     = useRef<string>('default')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef     = useRef<any>(null)
  const meetingStreamRef   = useRef<MediaStream | null>(null)   // stream que se manda al recorder
  const displayStreamRef   = useRef<MediaStream | null>(null)   // pestaña (getDisplayMedia)
  const micStreamRef       = useRef<MediaStream | null>(null)   // mic del usuario
  const sysStreamRef       = useRef<MediaStream | null>(null)   // mic de sistema (VB-Cable / Stereo Mix)
  const recorderRef        = useRef<MediaRecorder | null>(null)
  const audioContextRef    = useRef<AudioContext | null>(null)

  function addLog(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    console.log('[LiveSession]', msg)
    setDebugLogs(prev => [...prev.slice(-49), entry])
  }

  useEffect(() => { transcriptRef.current = transcript }, [transcript])

  useEffect(() => {
    try {
      const m = localStorage.getItem(STORAGE_AUDIO_MODE) as AudioMode | null
      const u = localStorage.getItem(STORAGE_USER_MIC)
      const s = localStorage.getItem(STORAGE_SYSTEM_MIC)
      if (m === 'mic' || m === 'tab' || m === 'both' || m === 'dual') { setAudioModeState(m); audioModeRef.current = m }
      if (u) { setUserMicIdState(u);   userMicIdRef.current = u }
      if (s) { setSystemMicIdState(s); systemMicIdRef.current = s }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false
      chunkActiveRef.current   = false
      recognitionRef.current?.abort()
      stopAllStreams()
      if (timerRef.current)        clearInterval(timerRef.current)
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setAudioMode = useCallback((m: AudioMode) => {
    setAudioModeState(m)
    audioModeRef.current = m
    try { localStorage.setItem(STORAGE_AUDIO_MODE, m) } catch { /* ignore */ }
  }, [])

  const setUserMicId = useCallback((id: string) => {
    setUserMicIdState(id)
    userMicIdRef.current = id
    try { localStorage.setItem(STORAGE_USER_MIC, id) } catch { /* ignore */ }
  }, [])

  const setSystemMicId = useCallback((id: string) => {
    setSystemMicIdState(id)
    systemMicIdRef.current = id
    try { localStorage.setItem(STORAGE_SYSTEM_MIC, id) } catch { /* ignore */ }
  }, [])

  function stopAllStreams() {
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop() } catch { /**/ }
    meetingStreamRef.current?.getTracks().forEach(t => t.stop())
    displayStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    sysStreamRef.current?.getTracks().forEach(t => t.stop())
    meetingStreamRef.current = null
    displayStreamRef.current = null
    micStreamRef.current     = null
    sysStreamRef.current     = null
    recorderRef.current      = null
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
  }

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.readAsDataURL(blob)
    })

  async function saveSegment(text: string, _speaker: 'me' | 'meeting') {
    if (!meetingIdRef.current) return
    const now = Date.now()
    await fetch(`/api/meetings/${meetingIdRef.current}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_ms: Math.max(0, now - sessionStartRef.current - CHUNK_MS),
        end_ms:   now - sessionStartRef.current,
        text, language: 'es',
      }),
    }).catch(() => {})
  }

  function addSegment(text: string, speaker: 'me' | 'meeting') {
    const seg: TranscriptSegment = {
      id:       crypto.randomUUID(),
      text,
      start_ms: Date.now() - sessionStartRef.current,
      end_ms:   Date.now() - sessionStartRef.current + 500,
      speaker,
    }
    setTranscript(prev => [...prev, seg])
    setWordCount(prev => prev + text.split(/\s+/).length)
    pendingTextRef.current += text + ' '

    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    suggestTimerRef.current = setTimeout(async () => {
      const pending = pendingTextRef.current.trim()
      if (pending.length > 10) {
        await requestSuggestions(pending.slice(-500))
        pendingTextRef.current = ''
      }
    }, SUGGEST_DEBOUNCE_MS)
  }

  async function requestSuggestions(segmentText: string) {
    if (!meetingIdRef.current) return
    try {
      const contextBefore = transcriptRef.current.slice(-3).map(s => s.text).join(' ')
      const body: Record<string, string> = { transcript_segment: segmentText, context_before: contextBefore }
      if (documentContextRef.current) body.document_context = documentContextRef.current.slice(0, 3000)
      const res = await fetch(`/api/meetings/${meetingIdRef.current}/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.suggestions?.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setSuggestions(prev => [...prev, ...data.suggestions.map((s: any) => ({ ...s, id: crypto.randomUUID() }))])
        }
      }
    } catch { /**/ }
  }

  // ─────────────────────────────────────────────────────────
  // SpeechRecognition: voz del usuario (azul, instantáneo)
  // ─────────────────────────────────────────────────────────
  function launchSpeechRecognition() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Cls = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Cls) { addLog('SpeechRecognition: no soportado'); return }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new Cls()
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = 'es-ES'

    rec.onresult = (event: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (event as any).results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idx = (event as any).resultIndex ?? 0
      let interim = ''

      for (let i = idx; i < results.length; i++) {
        if (results[i].isFinal) {
          const text = results[i][0].transcript.trim()
          if (text && text.length > 1) {
            addSegment(text, 'me')
            saveSegment(text, 'me')
          }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event as any).error === 'not-allowed') try { rec.abort() } catch { /**/ }
    }

    recognitionRef.current = rec
    try { rec.start() } catch { /**/ }
  }

  // Procesar chunks recurrentes desde un MediaStream → Whisper → speaker='meeting'
  function startChunkLoop(stream: MediaStream) {
    meetingStreamRef.current = stream
    chunkActiveRef.current   = true

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm'

    function recordChunk() {
      if (!chunkActiveRef.current || !meetingStreamRef.current) return
      const recorder = new MediaRecorder(
        new MediaStream(meetingStreamRef.current.getAudioTracks()),
        { mimeType }
      )
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }

      recorder.onstop = async () => {
        if (!chunkActiveRef.current) return
        const blob = new Blob(chunks, { type: mimeType })
        if (chunkActiveRef.current) recordChunk()
        if (blob.size < 200) return

        try {
          const base64 = await blobToBase64(blob)
          const res = await fetch('/api/live/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
          })
          if (res.ok) {
            const data = await res.json()
            const text: string = (data.text ?? '').trim()
            if (text && text.length > 1) {
              addLog(`Reunión: "${text.slice(0, 80)}"`)
              addSegment(text, 'meeting')
              saveSegment(text, 'meeting')
            }
          } else addLog(`API ${res.status}`)
        } catch (err) {
          addLog(`Fetch error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      recorder.start()
      setTimeout(() => {
        if (recorder.state === 'recording') try { recorder.stop() } catch { /**/ }
      }, CHUNK_MS)
    }
    recordChunk()
  }

  // ─────────────────────────────────────────────────────────
  // MODO: "Solo Pestaña" → sólo audio compartido por getDisplayMedia
  // ─────────────────────────────────────────────────────────
  async function launchTabCapture() {
    addLog('Tab: solicitando getDisplayMedia...')
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
    } as DisplayMediaStreamOptions)

    const audioTracks = displayStream.getAudioTracks()
    addLog(`Tab: audioTracks=${audioTracks.length}, videoTracks=${displayStream.getVideoTracks().length}`)

    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach(t => t.stop())
      throw new Error('No se encontró audio compartido. Selecciona "Pestaña" o "Toda la pantalla" y marca ✓ "Compartir audio".')
    }

    setAudioTracksOk(true)
    displayStreamRef.current = displayStream

    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (shouldRestartRef.current) {
        setError('Compartir pantalla detenido.')
        shouldRestartRef.current = false
        setIsListening(false)
      }
    })

    setIsListening(true)
    startChunkLoop(new MediaStream(displayStream.getAudioTracks()))
  }

  // ─────────────────────────────────────────────────────────
  // MODO: "Reunión Completa" → Pestaña + Mic (mezcla via WebAudio)
  // Idéntico al proyecto inicial: pide getDisplayMedia, después pide
  // el mic con el deviceId seleccionado, y MEZCLA ambos en un
  // MediaStreamDestination que se manda a Whisper como un solo stream.
  // ─────────────────────────────────────────────────────────
  async function launchCombinedCapture() {
    addLog('Combined: solicitando getDisplayMedia (con VIDEO)...')
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1, height: 1, frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
    } as DisplayMediaStreamOptions)

    const audioTracks = displayStream.getAudioTracks()
    addLog(`Combined: stream obtenido. audioTracks=${audioTracks.length}, videoTracks=${displayStream.getVideoTracks().length}`)

    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach(t => t.stop())
      throw new Error('No se encontró audio compartido. Selecciona "Pestaña" o "Toda la pantalla" y marca ✓ "Compartir audio".')
    }
    displayStreamRef.current = displayStream

    // Pedir el mic con el deviceId del usuario (o el predeterminado del sistema)
    const micConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
    }
    if (userMicIdRef.current && userMicIdRef.current !== 'default') {
      micConstraints.deviceId = { exact: userMicIdRef.current }
    }

    let micStream: MediaStream | null = null
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints, video: false })
      addLog(`Combined: mic obtenido "${micStream.getAudioTracks()[0]?.label}"`)
    } catch (err) {
      addLog(`Combined: mic preferido falló (${err instanceof Error ? err.message : err}). Fallback a default.`)
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        })
        addLog(`Combined: mic default obtenido "${micStream.getAudioTracks()[0]?.label}"`)
      } catch (err2) {
        addLog(`Combined: WARN sin mic — sólo audio de pestaña/sistema (${err2 instanceof Error ? err2.message : err2})`)
      }
    }
    if (micStream) micStreamRef.current = micStream

    // Mezcla tab + mic via Web Audio API → un solo MediaStream para MediaRecorder
    const audioCtx = audioContextRef.current ?? new AudioContext({ sampleRate: 16000 })
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume() } catch { /* ignore */ }
    }
    audioContextRef.current = audioCtx

    const destination = audioCtx.createMediaStreamDestination()
    const tabSource = audioCtx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks()))
    tabSource.connect(destination)
    addLog('Combined: tab source conectado al mix')

    if (micStream && micStream.getAudioTracks().length > 0) {
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(destination)
      addLog('Combined: mic source conectado al mix')
    } else {
      addLog('Combined: WARN sin mic en el mix')
    }

    const combinedStream = new MediaStream(destination.stream.getAudioTracks())

    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (shouldRestartRef.current) {
        setError('Compartir pantalla detenido.')
        shouldRestartRef.current = false
        setIsListening(false)
      }
    })

    setAudioTracksOk(true)
    setIsListening(true)
    startChunkLoop(combinedStream)
  }

  // ─────────────────────────────────────────────────────────
  // MODO: "Avanzado (Cable Virtual)" → dos getUserMedia
  // userMic → SpeechRecognition (azul). systemMic → Whisper (blanco)
  // ─────────────────────────────────────────────────────────
  async function launchDualCapture() {
    addLog('Dual: solicitando getUserMedia para system mic...')
    if (!systemMicIdRef.current || systemMicIdRef.current === 'none') {
      throw new Error('Selecciona un dispositivo en "Audio del sistema" (Stereo Mix o VB-Cable).')
    }

    const sysConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
    }
    if (systemMicIdRef.current !== 'default') {
      sysConstraints.deviceId = { exact: systemMicIdRef.current }
    }

    const sysStream = await navigator.mediaDevices.getUserMedia({ audio: sysConstraints, video: false })
    sysStreamRef.current = sysStream
    const sysTrack = sysStream.getAudioTracks()[0]
    const label = (sysTrack?.label ?? '').toLowerCase()
    addLog(`Dual: system mic "${sysTrack?.label}"`)

    // Heurística: si el dispositivo seleccionado parece un mic común (headset/bluetooth/microphone)
    // probablemente sólo captará la voz del usuario, NO el audio del sistema. Advertir.
    const isLikelyVirtualCable =
      label.includes('cable') || label.includes('vb-audio') ||
      label.includes('stereo mix') || label.includes('mezcla estéreo') ||
      label.includes('loopback') || label.includes('what u hear') || label.includes('voicemeeter')
    const isLikelyRegularMic =
      label.includes('headset') || label.includes('bluetooth') ||
      label.includes('microphone') || label.includes('micrófono') ||
      label.includes('mic ') || /\bmic\b/.test(label)

    if (!isLikelyVirtualCable && isLikelyRegularMic) {
      addLog(`Dual: WARN — "${sysTrack?.label}" parece un micrófono regular, no un loopback. Sólo capturará tu voz, no el audio de Teams/Zoom Desktop.`)
      setError(`"${sysTrack?.label}" parece un micrófono. Para capturar el audio de la reunión necesitas Stereo Mix o un cable virtual como VB-Cable. Instálalo y configúralo como salida en Teams/Zoom.`)
    }

    setAudioTracksOk(true)
    setIsListening(true)
    startChunkLoop(sysStream)
  }

  // ─────────────────────────────────────────────────────────
  // MODO: "Solo Micrófono" → sólo SpeechRecognition (sin Whisper)
  // ─────────────────────────────────────────────────────────
  // (la voz del usuario se cubre por SpeechRecognition)

  // ─────────────────────────────────────────────────────────
  // Ciclo de vida
  // ─────────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus('starting')
    setError(null)
    setTranscript([])
    setSuggestions([])
    setWordCount(0)
    setDuration(0)
    setAudioTracksOk(false)
    pendingTextRef.current = ''
    transcriptRef.current  = []

    // Crear AudioContext dentro del gesto del usuario
    try {
      const ctx = new AudioContext({ sampleRate: 16000 })
      await ctx.resume()
      audioContextRef.current = ctx
    } catch { /**/ }

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

      const mode = audioModeRef.current
      addLog(`Iniciando modo: ${mode}`)

      // SpeechRecognition siempre activo (voz local instantánea)
      launchSpeechRecognition()

      if (mode === 'both') {
        await launchCombinedCapture()
      } else if (mode === 'tab') {
        await launchTabCapture()
      } else if (mode === 'dual') {
        await launchDualCapture()
      } else {
        // 'mic': sólo SpeechRecognition (ya lanzado)
        setIsListening(true)
        setAudioTracksOk(true)
      }

      timerRef.current = setInterval(() => setDuration(d => d + 1), DURATION_TICK_MS)
      setStatus('active')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar'
      addLog(`ERROR: ${msg}`)
      setError(msg)
      setStatus('error')
      shouldRestartRef.current = false
      stopAllStreams()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endSession = useCallback(async () => {
    setStatus('ending')
    shouldRestartRef.current = false
    chunkActiveRef.current   = false

    try { recognitionRef.current?.abort() } catch { /**/ }
    recognitionRef.current = null
    stopAllStreams()
    setIsListening(false)
    setInterimText('')

    if (timerRef.current)        clearInterval(timerRef.current)
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)

    if (meetingId) {
      await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word_count: wordCount }),
      }).catch(() => {})
    }

    setStatus('done')
    setMeetingId(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, wordCount])

  const askAI = useCallback(async (customContext?: string) => {
    if (!meetingIdRef.current) return
    const recentText = transcriptRef.current.slice(-5).map(s => s.text).join(' ')
    const segment = customContext?.trim() || recentText
    if (!segment) { setError('Necesitas hablar primero.'); setTimeout(() => setError(null), 3000); return }
    await requestSuggestions(segment)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setDocumentContext = useCallback((text: string) => { documentContextRef.current = text }, [])
  const clearSuggestions   = useCallback(() => setSuggestions([]), [])

  const resetSession = useCallback(() => {
    setStatus('idle'); setMeetingId(null); setTranscript([]); setSuggestions([])
    setWordCount(0); setDuration(0); setError(null); setInterimText('')
    setAudioTracksOk(false)
    pendingTextRef.current = ''
    transcriptRef.current  = []
  }, [])

  return {
    status, meetingId, transcript, suggestions, wordCount, duration,
    error, isListening, interimText, audioTracksOk, debugLogs,
    audioMode, setAudioMode,
    userMicId, setUserMicId, systemMicId, setSystemMicId,
    startSession, endSession, askAI, clearSuggestions, setDocumentContext, resetSession,
  }
}
