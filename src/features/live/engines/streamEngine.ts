'use client'

// Motor en streaming (PRP-003 fase 2): el audio de la reunión va continuo a Soniox por
// WebSocket y regresan las palabras conforme se dicen (las no finales se reemplazan en cada
// mensaje) y la traducción en el mismo stream, sin esperar a que se cierre la frase.
// La llave es temporal (la crea /api/live/stt-token); si algo falla, el hook vuelve al
// motor por tramos.
import { startMeetingAudioTap } from '../audio/meetingAudio'
import { SAP_TERMS } from '../copilot/profile'
import type { EngineCallbacks, MeetingEngine } from './types'

const WS_URL             = 'wss://stt-rt.soniox.com/transcribe-websocket'
const MAX_SEGMENT_CHARS  = 600   // un turno larguísimo pasa al historial al cerrar una oración
const QUEUE_MAX_FRAMES   = 300   // 30 s de audio guardado mientras se abre la conexión
const CONNECT_TIMEOUT_MS = 8000
const TERMS_WAIT_MS      = 4000  // espera los términos de los documentos (el audio se guarda mientras)
const END_WAIT_MS        = 4000
const MAX_TERMS          = 300

export interface SonioxToken { text: string; is_final?: boolean; translation_status?: string }
export interface SonioxMessage { tokens?: SonioxToken[]; finished?: boolean; error_code?: number; error_type?: string; error_message?: string }

/**
 * Arma el turno con los tokens (lógica pura, se prueba sin red). Los finales se acumulan;
 * los no finales se reemplazan con cada mensaje. `<end>` = terminó la frase/turno.
 */
export class StreamTurns {
  private orig = ''
  private trans = ''
  private committedSinceTrans = false // ya se cerró el pedazo y aún puede llegar su traducción
  constructor(private cb: EngineCallbacks) {}

  handle(msg: SonioxMessage) {
    let liveOrig = '', liveTrans = '', heard = '', ends = 0
    for (const t of msg.tokens ?? []) {
      if (t.text === '<end>') { this.commit(); ends++; continue }
      if (t.text === '<fin>') continue
      const isTrans = t.translation_status === 'translation'
      if (!t.is_final) { if (isTrans) liveTrans += t.text; else liveOrig += t.text; continue }
      if (!isTrans) { this.orig += t.text; heard += t.text; this.committedSinceTrans = false; continue }
      // Traducción final que llega cuando el original ya pasó al historial: es de ese pedazo.
      if (!this.orig.trim() && this.committedSinceTrans && this.cb.amendTranslation) this.cb.amendTranslation(t.text)
      else this.trans += t.text
    }
    if (heard.trim()) this.cb.heard(heard.trim())
    if (!ends && this.orig.length >= MAX_SEGMENT_CHARS && /[.?!]\s*$/.test(this.orig)) this.commit()
    this.cb.preview({ text: this.orig.trim(), tentative: liveOrig.trim() })
    this.cb.translationPreview?.({ text: this.trans.trim(), tentative: liveTrans.trim() })
    for (let i = 0; i < ends; i++) this.cb.turnEnd()
  }

  commit() {
    const o = this.orig.trim(), t = this.trans.trim()
    this.orig = ''
    this.trans = ''
    if (o.length > 1) {
      this.cb.commit(o, t || undefined)
      this.committedSinceTrans = true
    }
  }
}

function toPcm16(frame: Float32Array): ArrayBuffer {
  const out = new Int16Array(frame.length)
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

export interface StreamEngineOptions {
  meetingId: string
  /** Idioma al que se traduce (siempre se pide: va incluido; la vista lo muestra si está activo). */
  translateTo: string | null
  /** Términos de los documentos de la reunión (pueden tardar unos segundos). */
  terms: () => Promise<string[]>
  /** La conexión se perdió y no se pudo recuperar: el hook cambia al motor por tramos. */
  onFail: (reason: string) => void
}

async function fetchToken(meetingId: string): Promise<{ apiKey: string; model: string }> {
  const res = await fetch('/api/live/stt-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId }) })
  const data = await res.json().catch(() => ({})) as { apiKey?: string; model?: string; error?: string }
  if (!res.ok || !data.apiKey || !data.model) throw new Error(data.error ?? `HTTP ${res.status}`)
  return { apiKey: data.apiKey, model: data.model }
}

export async function startStreamEngine(stream: MediaStream, cb: EngineCallbacks, opts: StreamEngineOptions): Promise<MeetingEngine> {
  let token = await fetchToken(opts.meetingId) // sin llave: lanza y el hook usa el motor por tramos
  const turns = new StreamTurns(cb)
  const queue: ArrayBuffer[] = []
  let ws: WebSocket | null = null
  let ready = false
  let stopping = false
  let finished = false
  let retried = false
  let terms: string[] = []

  // El audio empieza a guardarse ya; se manda en cuanto la conexión está lista.
  const tap = await startMeetingAudioTap(stream, {
    push(frame) {
      const buf = toPcm16(frame)
      if (ready && ws?.readyState === WebSocket.OPEN) ws.send(buf)
      else if (queue.length < QUEUE_MAX_FRAMES) queue.push(buf)
    },
  })

  function config(model: string) {
    return {
      model,
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['en', 'es'],
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: 1500,
      context: { terms: [...new Set([...SAP_TERMS, ...terms])].slice(0, MAX_TERMS) },
      ...(opts.translateTo ? { translation: { type: 'one_way', target_language: opts.translateTo } } : {}),
    }
  }

  function fail(reason: string) {
    if (stopping) return
    stopping = true
    cb.log(`Streaming: ${reason}`)
    tap.stop()
    try { ws?.close() } catch { /**/ }
    turns.commit()
    opts.onFail(reason)
  }

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ready = false
      const socket = new WebSocket(WS_URL, ['soniox-api-key', token.apiKey])
      socket.binaryType = 'arraybuffer'
      ws = socket
      const timer = setTimeout(() => { reject(new Error('la conexión no abrió a tiempo')); try { socket.close() } catch { /**/ } }, CONNECT_TIMEOUT_MS)
      socket.onopen = () => {
        clearTimeout(timer)
        socket.send(JSON.stringify(config(token.model)))
        for (const buf of queue.splice(0)) socket.send(buf)
        ready = true
        resolve()
      }
      socket.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== 'string') return
        let msg: SonioxMessage
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.error_code) { fail(`${msg.error_code} ${msg.error_type ?? ''} ${msg.error_message ?? ''}`.trim()); return }
        turns.handle(msg)
        if (msg.finished) finished = true
      }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('error de conexión')) }
      socket.onclose = () => {
        clearTimeout(timer)
        ready = false
        if (stopping || finished || ws !== socket) return
        // Se cayó a media reunión: una reconexión con llave nueva; si no, al motor por tramos.
        if (retried) { fail('se perdió la conexión'); return }
        retried = true
        cb.log('Streaming: reconectando…')
        void fetchToken(opts.meetingId).then(t => { token = t; return connect() }).catch(err => fail(err instanceof Error ? err.message : String(err)))
      }
    })
  }

  terms = await Promise.race([opts.terms().catch(() => []), new Promise<string[]>(r => setTimeout(() => r([]), TERMS_WAIT_MS))])
  try {
    await connect()
  } catch (err) {
    tap.stop()
    throw err
  }
  cb.log(`Streaming: conectado (${terms.length} términos de tus documentos)`)

  return {
    kind: 'stream',
    async stop() {
      if (stopping) return
      stopping = true
      tap.stop()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'finalize' }))
        ws.send('') // fin del audio: Soniox entrega lo pendiente y responde finished
        const deadline = Date.now() + END_WAIT_MS
        while (!finished && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
      }
      turns.commit()
      try { ws?.close() } catch { /**/ }
      cb.preview({ text: '', tentative: '' })
      cb.translationPreview?.({ text: '', tentative: '' })
    },
  }
}
