'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TranscriptSegment {
  id: string; text: string; start_ms: number; end_ms: number; speaker: string | null
}
export interface AiSuggestion {
  id?: string; type: 'reply' | 'question' | 'info' | 'warning'; text: string
}

export type LiveStatus = 'idle' | 'starting' | 'active' | 'ending' | 'done' | 'error'

const SUGGEST_DEBOUNCE_MS = 3000
const DURATION_TICK_MS = 1000
const TAB_CHUNK_MS = 3000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionCtor | undefined
    webkitSpeechRecognition: SpeechRecognitionCtor | undefined
  }
}

export function useLiveSession() {
  const [status, setStatus]           = useState<LiveStatus>('idle')
  const [meetingId, setMeetingId]     = useState<string | null>(null)
  const [transcript, setTranscript]   = useState<TranscriptSegment[]>([])
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [wordCount, setWordCount]     = useState(0)
  const [duration, setDuration]       = useState(0)
  const [error, setError]             = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [debugLogs, setDebugLogs]     = useState<string[]>([])

  const meetingIdRef        = useRef<string | null>(null)
  const timerRef            = useRef<ReturnType<typeof setInterval> | null>(null)
  const suggestTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionStartRef     = useRef<number>(0)
  const pendingTextRef      = useRef<string>('')
  const transcriptRef       = useRef<TranscriptSegment[]>([])
  const shouldRestartRef    = useRef<boolean>(false)
  const tabChunkActiveRef   = useRef<boolean>(false)
  const documentContextRef  = useRef<string>('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef      = useRef<any>(null)

  // Streams
  const tabStreamRef     = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef     = useRef<MediaStream | null>(null)
  const tabRecorderRef   = useRef<MediaRecorder | null>(null)
  const audioContextRef  = useRef<AudioContext | null>(null)
  const audioNodesRef    = useRef<{
    tabSource?: MediaStreamAudioSourceNode
    micSource?: MediaStreamAudioSourceNode
    destination?: MediaStreamAudioDestinationNode
  }>({})

  function addLog(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`
    console.log('[LiveSession]', msg)
    setDebugLogs(prev => [...prev.slice(-49), entry])
  }

  useEffect(() => { transcriptRef.current = transcript }, [transcript])

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false
      tabChunkActiveRef.current = false
      recognitionRef.current?.abort()
      stopTabStream()
      if (timerRef.current) clearInterval(timerRef.current)
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopTabStream() {
    if (tabRecorderRef.current?.state !== 'inactive') {
      try { tabRecorderRef.current?.stop() } catch { /* ignore */ }
    }
    tabStreamRef.current?.getTracks().forEach(t => t.stop())
    displayStreamRef.current?.getTracks().forEach(t => t.stop())
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    tabStreamRef.current = null
    displayStreamRef.current = null
    micStreamRef.current = null
    tabRecorderRef.current = null
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(console.error)
    }
    audioContextRef.current = null
    audioNodesRef.current = {}
  }

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '')
      reader.readAsDataURL(blob)
    })

  async function saveTranscriptSegment(text: string) {
    if (!meetingIdRef.current) return
    const now = Date.now()
    await fetch(`/api/meetings/${meetingIdRef.current}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_ms: Math.max(0, now - sessionStartRef.current - 3000),
        end_ms:   now - sessionStartRef.current,
        text, language: 'es',
      }),
    }).catch(() => {})
  }

  function addSegmentToState(text: string) {
    const segment: TranscriptSegment = {
      id:       crypto.randomUUID(),
      text,
      start_ms: Date.now() - sessionStartRef.current,
      end_ms:   Date.now() - sessionStartRef.current + 500,
      speaker:  null,
    }
    setTranscript(prev => [...prev, segment])
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
    } catch (err) {
      console.error('[suggest]', err)
    }
  }

  function launchInterimRecognition() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCls = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCls) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SpeechRecognitionCls()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'es-ES'

    recognition.onresult = (event: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = (event as any).results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultIndex = (event as any).resultIndex ?? 0
      let interText = ''
      for (let i = resultIndex; i < results.length; i++) {
        if (!results[i].isFinal) interText += results[i][0].transcript
      }
      setInterimText(interText)
    }

    recognition.onend = () => {
      if (shouldRestartRef.current) {
        try { recognition.start() } catch { /* ignore */ }
      } else {
        setInterimText('')
      }
    }

    recognition.onerror = (event: Event & { error?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event as any).error === 'not-allowed') {
        try { recognition.abort() } catch { /* ignore */ }
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch { /* ignore */ }
  }

  // ────────────────────────────────────────────────────────────
  // Modo "Reunión Completa": Pestaña + Micrófono (Web Audio mix)
  // ────────────────────────────────────────────────────────────

  async function launchCombinedCapture(preemptiveAudioCtx: AudioContext | null) {
    try {
      addLog('Combined: solicitando getDisplayMedia...')
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
      })

      const audioTracks = displayStream.getAudioTracks()
      addLog(`Combined: audioTracks=${audioTracks.length}`)

      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach(t => t.stop())
        setError('No se encontró audio en la pestaña. Asegúrate de marcar "Compartir audio de la pestaña".')
        setStatus('error')
        return
      }

      displayStreamRef.current = displayStream

      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        })
        micStreamRef.current = micStream
        addLog('Combined: micrófono obtenido')
      } catch (e) {
        addLog(`Combined: micrófono no disponible: ${e}`)
      }

      const audioCtx = preemptiveAudioCtx || new AudioContext({ sampleRate: 16000 })
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      audioContextRef.current = audioCtx

      const destination = audioCtx.createMediaStreamDestination()
      audioNodesRef.current.destination = destination

      const tabSource = audioCtx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks()))
      tabSource.connect(destination)
      audioNodesRef.current.tabSource = tabSource

      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(micStream)
        micSource.connect(destination)
        audioNodesRef.current.micSource = micSource
      }

      const combinedStream = new MediaStream(destination.stream.getAudioTracks())
      tabStreamRef.current = combinedStream
      tabChunkActiveRef.current = true
      setIsListening(true)

      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (shouldRestartRef.current) {
          setError('Compartir pantalla detenido.')
          shouldRestartRef.current = false
          setIsListening(false)
        }
      })

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'

      function recordChunk() {
        if (!tabChunkActiveRef.current || !tabStreamRef.current) return
        const recorder = new MediaRecorder(new MediaStream(tabStreamRef.current.getAudioTracks()), { mimeType })
        tabRecorderRef.current = recorder
        const chunks: Blob[] = []

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }

        recorder.onstop = async () => {
          if (!tabChunkActiveRef.current) return
          const blob = new Blob(chunks, { type: mimeType })
          if (tabChunkActiveRef.current) recordChunk()

          addLog(`Combined chunk: ${blob.size} bytes`)
          if (blob.size < 300) { addLog('Combined chunk: SKIPPED (too small)'); return }

          try {
            const base64 = await blobToBase64(blob)
            const res = await fetch('/api/live/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
            })
            if (res.ok) {
              const data = await res.json()
              const text: string = data.text?.trim() ?? ''
              addLog(`Combined chunk: "${text.slice(0, 80)}"`)
              if (text && text.length > 1) { addSegmentToState(text); saveTranscriptSegment(text) }
            } else {
              addLog(`Combined chunk: API error ${res.status}`)
            }
          } catch (err) {
            addLog(`Combined chunk: FETCH ERROR: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        recorder.start()
        setTimeout(() => {
          if (recorder.state === 'recording') try { recorder.stop() } catch { /* ignore */ }
        }, TAB_CHUNK_MS)
      }

      recordChunk()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al capturar audio'
      addLog(`Combined: ERROR: ${msg}`)
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        setError('Permiso denegado. Selecciona una pestaña y marca "Compartir audio de la pestaña".')
      } else {
        setError(msg)
      }
      setStatus('error')
      shouldRestartRef.current = false
      stopTabStream()
    }
  }

  // ────────────────────────────────────────────────────────────
  // Ciclo de vida de la sesión
  // ────────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setStatus('starting')
    setError(null)
    setTranscript([])
    setSuggestions([])
    setWordCount(0)
    setDuration(0)
    pendingTextRef.current = ''
    transcriptRef.current = []

    let preemptiveAudioCtx: AudioContext | null = null
    try {
      preemptiveAudioCtx = new AudioContext({ sampleRate: 16000 })
      await preemptiveAudioCtx.resume()
    } catch { /* ignore */ }

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al crear la sesión')

      meetingIdRef.current = data.meeting_id
      setMeetingId(data.meeting_id)
      sessionStartRef.current = Date.now()
      shouldRestartRef.current = true
      addLog(`Sesión creada: ${data.meeting_id}`)

      await launchCombinedCapture(preemptiveAudioCtx)
      launchInterimRecognition()

      timerRef.current = setInterval(() => setDuration(d => d + 1), DURATION_TICK_MS)
      setStatus('active')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar')
      setStatus('error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endSession = useCallback(async () => {
    setStatus('ending')
    shouldRestartRef.current = false
    tabChunkActiveRef.current = false

    try { recognitionRef.current?.abort() } catch { /* ignore */ }
    recognitionRef.current = null

    stopTabStream()
    setIsListening(false)

    if (timerRef.current) clearInterval(timerRef.current)
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current)
    setInterimText('')

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
    pendingTextRef.current = ''; transcriptRef.current = ''  as unknown as TranscriptSegment[]
  }, [])

  return {
    status, meetingId, transcript, suggestions, wordCount, duration,
    error, isListening, interimText, debugLogs,
    startSession, endSession, askAI, clearSuggestions, setDocumentContext, resetSession,
  }
}
