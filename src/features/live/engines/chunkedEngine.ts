'use client'

// Motor de respaldo: tramos cortados en pausas → /api/live/transcribe (Gemini).
// 15 oct (PRP-003): cada tramo se muestra en cuanto llega aunque uno anterior siga en
// camino (antes la entrega en orden estricto lo detenía todo y luego salía de golpe), y
// un tramo que no vuelve en 5 s ya no detiene a los demás.
import { encodeWav, OrderedDelivery, SpeechSegmenter, startMeetingAudioTap, type AudioSink } from '../audio/meetingAudio'
import type { EngineCallbacks, MeetingEngine } from './types'

const REQUEST_TIMEOUT_MS = 5000
const SHOW_PENDING_MS    = 900  // un tramo en camino por más de esto se ve como "…"
const FLUSH_CHARS        = 220  // un turno largo pasa al historial en pedazos legibles
const END_WAIT_MS        = 5500

type Delivered = { kind: 'text'; text: string } | { kind: 'turnEnd' }

/** Manda un tramo WAV y devuelve el texto ('' si no hubo voz). */
export type TranscribeFn = (wav: Blob, signal: AbortSignal) => Promise<string>

const transcribeViaApi: TranscribeFn = async (wav, signal) => {
  const res = await fetch('/api/live/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return String((await res.json()).text ?? '').trim()
}

export async function startChunkedEngine(stream: MediaStream, cb: EngineCallbacks): Promise<MeetingEngine> {
  const core = createChunkedTranscriber(cb, transcribeViaApi)
  const tap = await startMeetingAudioTap(stream, core.sink)
  return {
    kind: 'chunked',
    async stop() {
      tap.stop() // manda el último tramo pendiente
      await core.stop()
    },
  }
}

/** Lógica del motor sin Web Audio (se prueba con audio y respuestas simuladas). */
export function createChunkedTranscriber(cb: EngineCallbacks, send: TranscribeFn): { sink: AudioSink; stop(): Promise<void> } {
  // Tramos aún no entregados en orden: null = en camino, '' = sin voz, texto = ya llegó.
  const pending = new Map<number, { text: string | null; sentAt: number }>()
  let buffer = ''
  let inFlight = 0
  let repaint: ReturnType<typeof setTimeout> | null = null

  function emitPreview() {
    const parts: string[] = []
    let waiting = false
    for (const seq of [...pending.keys()].sort((a, b) => a - b)) {
      const slot = pending.get(seq)
      if (!slot) continue
      if (slot.text !== null) { if (slot.text) parts.push(slot.text); continue }
      waiting = true
      if (Date.now() - slot.sentAt > SHOW_PENDING_MS) parts.push('…')
    }
    cb.preview({ text: buffer, tentative: parts.join(' ') })
    if (repaint) clearTimeout(repaint)
    repaint = waiting ? setTimeout(emitPreview, SHOW_PENDING_MS) : null
  }

  function commit() {
    const t = buffer.trim()
    buffer = ''
    if (t.length > 1) cb.commit(t)
  }

  const delivery = new OrderedDelivery<Delivered>((d, seq) => {
    if (d.kind === 'turnEnd') {
      commit()
      emitPreview()
      cb.turnEnd()
      return
    }
    pending.delete(seq)
    if (d.text) buffer = `${buffer} ${d.text}`.trim()
    if (buffer.length >= FLUSH_CHARS) commit()
    emitPreview()
  })

  async function transcribe(pcm: Float32Array) {
    const seq = delivery.ticket()
    pending.set(seq, { text: null, sentAt: Date.now() })
    inFlight++
    let text = ''
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      text = await send(encodeWav(pcm), ctrl.signal)
    } catch (err) {
      cb.log(ctrl.signal.aborted
        ? `Tramo ${seq}: sin respuesta en ${REQUEST_TIMEOUT_MS / 1000} s; los demás siguen`
        : `Fetch error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      clearTimeout(timer)
      inFlight--
    }
    if (text.length < 2) text = ''
    const slot = pending.get(seq)
    if (slot) slot.text = text
    if (text) cb.heard(text)
    emitPreview()
    delivery.resolve(seq, { kind: 'text', text })
  }

  const segmenter = new SpeechSegmenter(
    pcm => { void transcribe(pcm) },
    () => delivery.resolve(delivery.ticket(), { kind: 'turnEnd' }),
  )

  return {
    sink: segmenter,
    async stop() {
      segmenter.flush()
      const deadline = Date.now() + END_WAIT_MS
      while (inFlight > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
      commit()
      if (repaint) clearTimeout(repaint)
      pending.clear()
      cb.preview({ text: '', tentative: '' })
    },
  }
}
