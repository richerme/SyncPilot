'use client'

import { create } from 'zustand'

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
  chunks: Blob[]
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
  mediaRecorder: null, chunks: [], mimeType: 'video/webm',
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

const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB

async function uploadChunked(
  blob: Blob,
  recordingId: string,
  onProgress: (pct: number, uploaded: number, total: number) => void,
  onError: (msg: string) => void,
  onSuccess: () => void,
) {
  const total = blob.size
  const totalChunks = Math.ceil(total / CHUNK_SIZE)
  let uploaded = 0

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, total)
    const chunk = blob.slice(start, end)

    const form = new FormData()
    form.append('chunk', chunk)
    form.append('chunkIndex', String(i))
    form.append('totalChunks', String(totalChunks))
    form.append('mimeType', refs.mimeType)

    try {
      const res = await fetch(`/api/recordings/${recordingId}/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onError(data.error ?? 'Error al subir el video')
        return
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error de red')
      return
    }

    uploaded += (end - start)
    onProgress(Math.round((uploaded / total) * 100), uploaded, total)
  }

  onSuccess()
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
        video: { width: 1920, height: 1080, frameRate: 30 } as MediaTrackConstraints,
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

      // 6. MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus' : 'video/webm'
      refs.mimeType = mimeType

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000,
      })
      refs.mediaRecorder = mediaRecorder
      refs.chunks = []

      mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) refs.chunks.push(e.data) }

      mediaRecorder.onstop = () => {
        const capturedId = refs.storedRecordingId
        const finalBlob = new Blob(refs.chunks, { type: refs.mimeType })
        stopAllStreams()

        if (!capturedId) {
          set({ status: 'error', error: 'No se encontró ID de grabación.' })
          return
        }

        set({ status: 'uploading', totalBytes: finalBlob.size, uploadedBytes: 0, progress: 0 })

        uploadChunked(
          finalBlob, capturedId,
          (pct, uploaded, total) => set({ progress: pct, uploadedBytes: uploaded, totalBytes: total }),
          msg => set({ status: 'error', error: msg }),
          () => set({ status: 'done', progress: 100 }),
        )
      }

      mediaRecorder.start(5000)
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
    refs.chunks = []
    refs.storedRecordingId = null
    set(INITIAL)
  },
}))
