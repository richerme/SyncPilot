'use client'

import { create } from 'zustand'
import { createChunkUploader, type ChunkUploader } from '../services/chunkUploader'

export type RecordingStatus =
  | 'idle' | 'requesting-permissions' | 'recording' | 'paused' | 'uploading' | 'done' | 'error'

interface RecordingState {
  status: RecordingStatus
  duration: number
  audioLevel: number
  progress: number
  uploadedBytes: number
  totalBytes: number
  recordingId: string | null
  slug: string | null
  error: string | null
  webcamEnabled: boolean
}

interface RecordingActions {
  startRecording: (opts: { title: string; includeSystemAudio: boolean; includeWebcam: boolean }) => Promise<void>
  stopRecording: () => void
  pauseRecording: () => void
  resumeRecording: () => void
  toggleWebcam: () => void
  reset: () => void
}

interface MediaRefs {
  mediaRecorder: MediaRecorder | null
  uploader: ChunkUploader | null
  mimeType: string
  displayStream: MediaStream | null
  micStream: MediaStream | null
  webcamStream: MediaStream | null
  audioContext: AudioContext | null
  analyser: AnalyserNode | null
  timerInterval: ReturnType<typeof setInterval> | null
  animationFrame: number | null
  storedRecordingId: string | null
}

const refs: MediaRefs = {
  mediaRecorder: null, uploader: null, mimeType: 'video/webm',
  displayStream: null, micStream: null, webcamStream: null,
  audioContext: null, analyser: null,
  timerInterval: null, animationFrame: null, storedRecordingId: null,
}

function stopAllStreams() {
  refs.displayStream?.getTracks().forEach(t => t.stop())
  refs.micStream?.getTracks().forEach(t => t.stop())
  refs.webcamStream?.getTracks().forEach(t => t.stop())
  if (refs.audioContext && refs.audioContext.state !== 'closed') {
    refs.audioContext.close().catch(() => {})
  }
  if (refs.animationFrame) cancelAnimationFrame(refs.animationFrame)
  if (refs.timerInterval) clearInterval(refs.timerInterval)
  refs.displayStream = refs.micStream = refs.webcamStream = refs.audioContext = refs.analyser = null
  refs.animationFrame = refs.timerInterval = null
}

// Códec: H.264 primero porque Chrome/Edge lo codifican con la tarjeta de video
// (VP9, el anterior, se codifica por software y era lo que más CPU consumía en
// reuniones largas). VP8 queda de respaldo: también es mucho más ligero que VP9.
const VIDEO_TYPES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
]
// Pantalla compartida de reunión: 15 fps y 2.5 Mbps se ven nítidos y cuestan
// la mitad que 30 fps / 5 Mbps (menos CPU, menos red y archivos más chicos).
const FRAME_RATE = 15
const VIDEO_BITRATE = 2_500_000
const TIMESLICE_MS = 5000

async function completeRecording(recordingId: string, durationSecs: number) {
  const res = await fetch(`/api/recordings/${recordingId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationSecs }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'No se pudo terminar la grabación')
  }
}

const INITIAL: RecordingState = {
  status: 'idle', duration: 0, audioLevel: 0,
  progress: 0, uploadedBytes: 0, totalBytes: 0,
  recordingId: null, slug: null, error: null, webcamEnabled: false,
}

export const useRecordingStore = create<RecordingState & RecordingActions>((set, get) => ({
  ...INITIAL,

  startRecording: async ({ title, includeSystemAudio, includeWebcam }) => {
    set({ status: 'requesting-permissions', error: null })
    try {
      // 1. Crear registro en BD
      const res = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al crear grabación')

      const recordingId: string = data.recording_id
      refs.storedRecordingId = recordingId
      set({ recordingId, slug: data.slug })

      // 2. Captura de pantalla
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: FRAME_RATE, max: FRAME_RATE } } as MediaTrackConstraints,
        audio: includeSystemAudio,
      })
      refs.displayStream = displayStream
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => get().stopRecording())

      // 3. Micrófono (opcional)
      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        refs.micStream = micStream
      } catch { /* continuar sin micrófono */ }

      // 4. Webcam (opcional)
      if (includeWebcam) {
        try {
          refs.webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 360, facingMode: 'user' },
          })
          set({ webcamEnabled: true })
        } catch { /* continuar sin webcam */ }
      }

      // 5. Mezclar audio via Web Audio API
      const combinedStream = new MediaStream()
      displayStream.getVideoTracks().forEach(t => combinedStream.addTrack(t))

      const audioCtx = new AudioContext()
      refs.audioContext = audioCtx
      const destination = audioCtx.createMediaStreamDestination()

      if (includeSystemAudio && displayStream.getAudioTracks().length > 0) {
        audioCtx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks())).connect(destination)
      }
      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(micStream)
        micSource.connect(destination)

        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        micSource.connect(analyser)
        refs.analyser = analyser

        // Buffer reutilizado (no se asigna uno nuevo por frame) y actualización
        // del nivel limitada a ~12 fps: el medidor de audio se ve igual de fluido
        // pero evita 60 setState/seg y la presión de GC durante grabaciones largas.
        const data = new Uint8Array(analyser.frequencyBinCount)
        let lastUpdate = 0
        const tick = (now: number) => {
          if (!refs.analyser) return
          if (now - lastUpdate > 80) {
            refs.analyser.getByteFrequencyData(data)
            const avg = data.reduce((a, b) => a + b, 0) / data.length
            set({ audioLevel: Math.round((avg / 255) * 100) })
            lastUpdate = now
          }
          refs.animationFrame = requestAnimationFrame(tick)
        }
        refs.animationFrame = requestAnimationFrame(tick)
      }

      destination.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t))

      // 6. MediaRecorder: cada pedazo se sube en cuanto sale (ver chunkUploader)
      const mimeType = VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      refs.mimeType = mimeType || 'video/webm'

      const mediaRecorder = new MediaRecorder(combinedStream, {
        ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128_000,
      })
      refs.mediaRecorder = mediaRecorder
      const uploader = createChunkUploader(recordingId, (uploaded, recorded) => {
        // Durante la grabación solo se actualiza el contador; la barra se usa al final.
        if (get().status === 'uploading') {
          set({ uploadedBytes: uploaded, totalBytes: recorded, progress: recorded ? Math.round((uploaded / recorded) * 100) : 0 })
        }
      })
      refs.uploader = uploader

      mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) uploader.push(e.data) }

      mediaRecorder.onstop = async () => {
        const capturedId = refs.storedRecordingId
        stopAllStreams()
        if (!capturedId) {
          set({ status: 'error', error: 'No se encontró ID de grabación.' })
          return
        }
        const recorded = uploader.recordedBytes()
        const uploaded = uploader.uploadedBytes()
        set({ status: 'uploading', totalBytes: recorded, uploadedBytes: uploaded, progress: recorded ? Math.round((uploaded / recorded) * 100) : 0 })
        try {
          await uploader.finish()
          await completeRecording(capturedId, get().duration)
          set({ status: 'done', progress: 100 })
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : 'Error al subir el video' })
        }
      }

      mediaRecorder.start(TIMESLICE_MS)
      set({ status: 'recording' })
      refs.timerInterval = setInterval(() => set(s => ({ duration: s.duration + 1 })), 1000)

    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'Error al iniciar grabación' })
      stopAllStreams()
    }
  },

  stopRecording: () => {
    if (refs.mediaRecorder && refs.mediaRecorder.state !== 'inactive') {
      if (refs.timerInterval) { clearInterval(refs.timerInterval); refs.timerInterval = null }
      refs.mediaRecorder.stop()
    }
  },

  pauseRecording: () => {
    if (refs.mediaRecorder?.state === 'recording') {
      refs.mediaRecorder.pause()
      if (refs.timerInterval) { clearInterval(refs.timerInterval); refs.timerInterval = null }
      set({ status: 'paused' })
    }
  },

  resumeRecording: () => {
    if (refs.mediaRecorder?.state === 'paused') {
      refs.mediaRecorder.resume()
      refs.timerInterval = setInterval(() => set(s => ({ duration: s.duration + 1 })), 1000)
      set({ status: 'recording' })
    }
  },

  toggleWebcam: () => {
    refs.webcamStream?.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    set(s => ({ webcamEnabled: !s.webcamEnabled }))
  },

  reset: () => {
    stopAllStreams()
    refs.mediaRecorder = null
    refs.uploader = null
    refs.storedRecordingId = null
    set(INITIAL)
  },
}))
