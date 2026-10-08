'use client'

// Sube los pedazos del MediaRecorder MIENTRAS se graba, en orden y con reintentos.
// Así la memoria del navegador no crece con la duración de la reunión (antes se
// guardaba todo el video en RAM y se subía al final) y al detener solo falta el
// último pedazo. Cada pedazo lleva su posición en bytes (offset): si un reintento
// llega después de que el servidor ya lo había guardado, el servidor lo reconoce
// y no lo duplica.

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]

interface Pending { blob: Blob; offset: number }

export interface ChunkUploader {
  push: (blob: Blob) => void
  /** Espera a que se suba todo lo pendiente (reintenta lo que haya fallado). */
  finish: () => Promise<void>
  recordedBytes: () => number
  uploadedBytes: () => number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function createChunkUploader(recordingId: string, onProgress: (uploaded: number, recorded: number) => void): ChunkUploader {
  const queue: Pending[] = []
  let recorded = 0
  let uploaded = 0
  let running: Promise<void> | null = null
  let lastError: string | null = null

  async function sendOne(p: Pending): Promise<void> {
    const form = new FormData()
    form.append('chunk', p.blob)
    form.append('offset', String(p.offset))
    const res = await fetch(`/api/recordings/${recordingId}/upload`, { method: 'POST', body: form })
    if (res.ok) return
    const data = await res.json().catch(() => ({})) as { error?: string; size?: number }
    // El servidor ya tenía este pedazo (respuesta perdida en un reintento).
    if (res.status === 409 && data.size === p.offset + p.blob.size) return
    const err = new Error(data.error ?? `HTTP ${res.status}`)
    // 4xx (salvo 408/429) no se arregla reintentando.
    ;(err as Error & { fatal?: boolean }).fatal = res.status < 500 && ![408, 429].includes(res.status)
    throw err
  }

  async function drain(): Promise<void> {
    while (queue.length) {
      const p = queue[0]
      for (let attempt = 0; ; attempt++) {
        try {
          await sendOne(p)
          break
        } catch (e) {
          const fatal = (e as Error & { fatal?: boolean }).fatal
          if (fatal || attempt >= RETRY_DELAYS_MS.length) {
            lastError = e instanceof Error ? e.message : 'Error de red'
            return // se reintenta en finish()
          }
          await sleep(RETRY_DELAYS_MS[attempt])
        }
      }
      queue.shift()
      uploaded += p.blob.size
      lastError = null
      onProgress(uploaded, recorded)
    }
  }

  function kick() {
    if (!running) running = drain().finally(() => { running = null })
  }

  return {
    push(blob) {
      if (!blob.size) return
      queue.push({ blob, offset: recorded })
      recorded += blob.size
      onProgress(uploaded, recorded)
      kick()
    },
    async finish() {
      if (running) await running
      if (queue.length) { kick(); await running }
      if (queue.length) throw new Error(lastError ?? 'No se pudo subir el video')
    },
    recordedBytes: () => recorded,
    uploadedBytes: () => uploaded,
  }
}
