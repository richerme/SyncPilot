'use client'

import { useRef, useState, useCallback } from 'react'

export interface AudioRecorderState {
  isRecording:  boolean
  countdown:    number
  audioBase64:  string | null
  mimeType:     string
  error:        string | null
}

export function useAudioRecorder(maxSeconds = 30) {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false, countdown: 0, audioBase64: null,
    mimeType: 'audio/webm', error: null,
  })

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef    = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async () => {
    try {
      setState(s => ({ ...s, error: null, audioBase64: null }))
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
        video: false,
      })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current   = []

      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1] ?? ''
          setState(s => ({ ...s, isRecording: false, countdown: 0, audioBase64: base64, mimeType }))
        }
        reader.readAsDataURL(blob)
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }

      recorder.start()
      setState(s => ({ ...s, isRecording: true, countdown: maxSeconds }))

      let remaining = maxSeconds
      timerRef.current = setInterval(() => {
        remaining -= 1
        setState(s => ({ ...s, countdown: remaining }))
        if (remaining <= 0) stopRecording()
      }, 1000)

    } catch (err) {
      setState(s => ({ ...s, error: err instanceof Error ? err.message : 'Error al acceder al micrófono', isRecording: false }))
    }
  }, [maxSeconds])

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (recorderRef.current?.state !== 'inactive') {
      try { recorderRef.current?.stop() } catch { /* ignore */ }
    }
  }, [])

  const reset = useCallback(() => {
    stopRecording()
    setState({ isRecording: false, countdown: 0, audioBase64: null, mimeType: 'audio/webm', error: null })
  }, [stopRecording])

  return { ...state, startRecording, stopRecording, reset }
}
