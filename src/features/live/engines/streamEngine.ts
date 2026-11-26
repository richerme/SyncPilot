'use client'

// Motor en streaming (PRP-003 fase 2): el audio de la reunión va continuo a Soniox por
// WebSocket y regresan las palabras conforme se dicen (las no finales se reemplazan en cada
// mensaje) y la traducción en el mismo stream, sin esperar a que se cierre la frase.
// La llave es temporal (la crea /api/live/stt-token); si algo falla, el hook vuelve al
// motor por tramos.
import { startMeetingAudioTap } from '../audio/meetingAudio'
import { NAME_PATTERN, SAP_TERMS } from '../copilot/profile'
import type { EngineCallbacks, MeetingEngine } from './types'
import { after, every } from '../utils/ticker'

const WS_URL             = 'wss://stt-rt.soniox.com/transcribe-websocket'
const MAX_SEGMENT_CHARS  = 600   // un turno larguísimo pasa al historial al cerrar una oración
const QUEUE_MAX_FRAMES   = 300   // 30 s de audio guardado mientras se abre la conexión
const CONNECT_TIMEOUT_MS = 8000
const TERMS_WAIT_MS      = 4000  // espera los términos de los documentos (el audio se guarda mientras)
const END_WAIT_MS        = 4000
const MAX_TERMS          = 300
// Vigilante (18 nov 2026: la transcripción y la traducción se congelaban a media reunión y había que
// reiniciar). Con la conexión sana, Soniox manda un mensaje cada ~1 s aun en silencio (medido: 18 en
// 20 s, hueco máximo 1.2 s), así que 10 s sin mensajes con la conexión abierta = conexión colgada.
const STALL_MS            = 10_000
const MAX_BUFFERED        = 1_000_000 // ~30 s de audio que no sale del navegador
const NO_AUDIO_MS         = 3000      // el worklet entrega 10 tramos por segundo
const WATCH_MS            = 1000
const MAX_RECONNECTS      = 6         // por ventana de 10 min; después, al motor por tramos
const RECONNECT_WINDOW_MS = 10 * 60_000
const DRAIN_MS            = 2500      // cambio de idioma: lo que espera a la conexión vieja

export type WatchVerdict = 'ok' | 'no-audio' | 'stalled' | 'backlog'

/** Decide con los tiempos si dejó de llegar el audio o si la conexión se colgó (lógica pura, se prueba sin red). */
export class StreamWatchdog {
  private lastMsgAt: number
  private lastFrameAt: number
  constructor(now: number) { this.lastMsgAt = now; this.lastFrameAt = now }
  frame(now: number) { this.lastFrameAt = now }
  message(now: number) { this.lastMsgAt = now }
  /** Vuelve a contar desde ahora (al reconectar o mientras no hay audio que mandar). */
  reset(now: number) { this.lastMsgAt = now }
  silentFor(now: number) { return now - this.lastMsgAt }
  check(now: number, open: boolean, buffered: number): WatchVerdict {
    if (now - this.lastFrameAt > NO_AUDIO_MS) { this.reset(now); return 'no-audio' }
    if (!open) return 'ok'
    if (buffered > MAX_BUFFERED) return 'backlog'
    if (now - this.lastMsgAt > STALL_MS) return 'stalled'
    return 'ok'
  }
}

/** Cuántas reconexiones van en la ventana; `null` si ya no se permite otra. */
export function nextReconnect(times: number[], now: number): number[] | null {
  const recent = times.filter(t => now - t < RECONNECT_WINDOW_MS)
  return recent.length >= MAX_RECONNECTS ? null : [...recent, now]
}

// Palabras muy comunes para desempatar el idioma de una frase (sin las que se escriben igual en los dos, como «no» o «a»).
const EN_WORDS = new Set(['the', 'and', 'is', 'are', 'we', 'you', 'that', 'this', 'it', 'to', 'of', 'for', 'with', 'have', 'has', 'will', 'can', 'what', 'how', 'do', 'does', 'be', 'on', 'in', 'so', 'just', 'okay', 'right', 'yeah', 'they', 'our', 'your', 'there', 'need', 'should', 'would', 'could', "it's", "don't", 'about', 'then', 'also', 'if', 'when'])
const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'que', 'de', 'y', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'se', 'lo', 'como', 'pero', 'más', 'muy', 'ya', 'también', 'está', 'son', 'del', 'al', 'su', 'sus', 'este', 'esta', 'eso', 'esto', 'hay', 'tiene', 'vamos', 'entonces', 'bueno', 'sí', 'cuando', 'porque', 'pues', 'nos'])

/**
 * Idioma de una frase cerrada (decisión 1a del 25 nov): la mayoría de los tokens de Soniox, no el último, y un
 * desempate barato por palabras comunes cuando el texto dice claramente otra cosa (lógica pura, se prueba sin red).
 */
export function phraseLanguage(counts: Record<string, number>, text: string): string {
  const words = text.toLowerCase().match(/[a-záéíóúñü']+/g) ?? []
  let en = 0, es = 0
  for (const w of words) { if (EN_WORDS.has(w)) en++; else if (ES_WORDS.has(w)) es++ }
  if (en >= 2 && en > es * 2) return 'en'
  if (es >= 2 && es > en * 2) return 'es'
  let best = '', most = 0
  for (const [lang, n] of Object.entries(counts)) if (n > most) { best = lang; most = n }
  return best
}

export interface SonioxToken { text: string; is_final?: boolean; translation_status?: string; language?: string }
export interface SonioxMessage { tokens?: SonioxToken[]; finished?: boolean; error_code?: number; error_type?: string; error_message?: string }

/**
 * Arma el turno con los tokens (lógica pura, se prueba sin red). Los finales se acumulan;
 * los no finales se reemplazan con cada mensaje. `<end>` = terminó la frase/turno.
 */
export class StreamTurns {
  private orig = ''
  private trans = ''
  private committedSinceTrans = false // ya se cerró el pedazo y aún puede llegar su traducción
  private langCounts: Record<string, number> = {} // idioma de cada token final del pedazo en curso
  /** Frases que Soniox no tradujo y se mandaron a la traducción de respaldo (Gemini). */
  fallbacks = 0
  /** `target`: idioma de la traducción. Lo que ya se dice en ese idioma no trae traducción: se muestra tal cual. */
  constructor(private cb: EngineCallbacks, private target: string | null = null) {}

  /** Nuevo idioma de la traducción (cambio a media reunión, PRP-005). */
  setTarget(target: string | null) { this.target = target }

  /** ¿El pedazo en curso ya está en el idioma de la traducción? Por mayoría de tokens, no por el último (25 nov). */
  private sameLanguage(): boolean {
    if (!this.target) return false
    const lang = phraseLanguage(this.langCounts, this.orig)
    return !!lang && lang.toLowerCase().startsWith(this.target.toLowerCase())
  }

  handle(msg: SonioxMessage) {
    let liveOrig = '', liveTrans = '', heard = '', ends = 0
    for (const t of msg.tokens ?? []) {
      if (t.text === '<end>') { this.commit(); ends++; continue }
      if (t.text === '<fin>') continue
      const isTrans = t.translation_status === 'translation'
      if (!t.is_final) { if (isTrans) liveTrans += t.text; else liveOrig += t.text; continue }
      if (!isTrans) {
        if (t.language && t.text.trim()) this.langCounts[t.language] = (this.langCounts[t.language] ?? 0) + 1
        this.orig += t.text; heard += t.text; this.committedSinceTrans = false; continue
      }
      // Traducción final que llega cuando el original ya pasó al historial: es de ese pedazo.
      if (!this.orig.trim() && this.committedSinceTrans && this.cb.amendTranslation) this.cb.amendTranslation(t.text)
      else this.trans += t.text
    }
    if (heard.trim()) this.cb.heard(heard.trim())
    // Las palabras finales pueden tardar segundos en una frase larga: el nombre se detecta
    // desde las tentativas para que el Copiloto quede listo al terminar la pregunta.
    else if (NAME_PATTERN.test(liveOrig)) this.cb.heard(liveOrig.trim())
    if (!ends && this.orig.length >= MAX_SEGMENT_CHARS && /[.?!]\s*$/.test(this.orig)) this.commit()
    this.cb.preview({ text: this.orig.trim(), tentative: liveOrig.trim() })
    const same = this.sameLanguage() && !this.trans.trim() && !liveTrans.trim()
    this.cb.translationPreview?.(same
      ? { text: this.orig.trim(), tentative: liveOrig.trim() }
      : { text: this.trans.trim(), tentative: liveTrans.trim() })
    for (let i = 0; i < ends; i++) this.cb.turnEnd()
  }

  commit() {
    const o = this.orig.trim(), t = this.trans.trim()
    const same = this.sameLanguage()
    this.orig = ''
    this.trans = ''
    this.langCounts = {}
    if (o.length > 1) {
      // Español de verdad (o el idioma de la traducción) se muestra tal cual; otro idioma sin traducción de Soniox
      // va al respaldo y la fila dice «Traduciendo…» en lugar de repetir el original (decisión 1a, 25 nov).
      const fallback = !t && !same && !!this.target && !!this.cb.translateFallback
      this.cb.commit(o, t || (same ? o : undefined))
      this.committedSinceTrans = true
      if (fallback) {
        this.fallbacks++
        this.cb.translateFallback!(o)
        if (this.fallbacks === 1 || this.fallbacks % 10 === 0) this.cb.diag?.('translate-fallback', { n: this.fallbacks, chars: o.length })
      }
    }
  }
}

/**
 * Contexto para Soniox (máx. 8,000 tokens): de qué trata la conversación, vocabulario SAP +
 * términos de los documentos, y términos que la traducción debe dejar tal cual.
 */
export function sonioxContext(docTerms: string[]) {
  const terms = [...new Set([...SAP_TERMS, ...docTerms])].slice(0, MAX_TERMS)
  return {
    general: [
      { key: 'domain', value: 'SAP ERP consulting' },
      { key: 'topic', value: 'Work meeting of an SAP ABAP consultant (Rick) with clients and functional consultants about requirements, enhancements, interfaces and testing' },
    ],
    text: 'Typical phrases: the BAdI enhancement for the sales order, the IDoc interface, a BAPI or RFC call, the CDS view, the transport to Quality (QAS), the functional spec, the ALV report.',
    terms,
    translation_terms: SAP_KEEP.map(term => ({ source: term, target: term })),
  }
}

// En la traducción se quedan igual (en SAP en español también se dicen así).
const SAP_KEEP = ['BAdI', 'IDoc', 'BAPI', 'RFC', 'CDS view', 'OData', 'Fiori', 'ALV', 'SmartForms', 'Adobe Forms', 'user exit', 'S/4HANA', 'ABAP']

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
  // Con tiempo límite: una reconexión nunca debe quedarse esperando la llave para siempre.
  const res = await fetch('/api/live/stt-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId }), signal: AbortSignal.timeout(10_000) })
  const data = await res.json().catch(() => ({})) as { apiKey?: string; model?: string; error?: string }
  if (!res.ok || !data.apiKey || !data.model) throw new Error(data.error ?? `HTTP ${res.status}`)
  return { apiKey: data.apiKey, model: data.model }
}

export async function startStreamEngine(stream: MediaStream, cb: EngineCallbacks, opts: StreamEngineOptions): Promise<MeetingEngine> {
  let token = await fetchToken(opts.meetingId) // sin llave: lanza y el hook usa el motor por tramos
  const turns = new StreamTurns(cb, opts.translateTo)
  const queue: ArrayBuffer[] = []
  let ws: WebSocket | null = null
  let ready = false
  let stopping = false
  let finished = false
  let terms: string[] = []
  let reconnectTimes: number[] = []
  let reconnecting = false
  let audioStalled = false
  let stopWatchTicker: (() => void) | null = null
  let translateTo = opts.translateTo
  let draining: WebSocket | null = null // conexión vieja que termina de entregar tras un cambio de idioma
  const watchdog = new StreamWatchdog(Date.now())

  // El audio empieza a guardarse ya; se manda en cuanto la conexión está lista.
  const tap = await startMeetingAudioTap(stream, {
    push(frame) {
      watchdog.frame(Date.now())
      if (audioStalled) {
        audioStalled = false
        cb.log('Audio: volvió a llegar el audio de la reunión')
        cb.diag?.('audio-back')
        if (!reconnecting) cb.status?.('ok')
      }
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
      enable_language_identification: true,
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: 1500,
      context: sonioxContext(terms),
      ...(translateTo ? { translation: { type: 'one_way', target_language: translateTo } } : {}),
    }
  }

  function stopWatch() {
    stopWatchTicker?.()
    stopWatchTicker = null
  }

  function fail(reason: string) {
    if (stopping) return
    stopping = true
    stopWatch()
    cb.log(`Streaming: ${reason}`)
    cb.diag?.('fail', { reason })
    tap.stop()
    try { ws?.close() } catch { /**/ }
    turns.commit()
    opts.onFail(reason)
  }

  let connectedOnce = false

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ready = false
      const socket = new WebSocket(WS_URL, ['soniox-api-key', token.apiKey])
      socket.binaryType = 'arraybuffer'
      ws = socket
      const cancelTimer = after(CONNECT_TIMEOUT_MS, () => { reject(new Error('la conexión no abrió a tiempo')); try { socket.close() } catch { /**/ } })
      socket.onopen = () => {
        cancelTimer()
        socket.send(JSON.stringify(config(token.model)))
        for (const buf of queue.splice(0)) socket.send(buf)
        ready = true
        connectedOnce = true
        watchdog.reset(Date.now())
        resolve()
      }
      socket.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== 'string') return
        // La conexión vieja de un cambio de idioma aún entrega sus últimas palabras (ver drain()).
        if (ws !== socket) {
          if (draining !== socket) return
          try { turns.handle(JSON.parse(e.data) as SonioxMessage) } catch { /**/ }
          return
        }
        watchdog.message(Date.now())
        let msg: SonioxMessage
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.error_code) {
          // Un error de Soniox a media reunión (p. ej. tiempo máximo del stream) se intenta reconectar.
          const reason = `${msg.error_code} ${msg.error_type ?? ''} ${msg.error_message ?? ''}`.trim()
          if (msg.error_code === 401 || msg.error_code === 402 || msg.error_code === 403) fail(reason)
          else reconnect(`Soniox respondió ${reason}`)
          return
        }
        turns.handle(msg)
        if (msg.finished) finished = true
      }
      socket.onerror = () => { cancelTimer(); reject(new Error('error de conexión')) }
      socket.onclose = (e: CloseEvent) => {
        cancelTimer()
        if (ws !== socket) return
        ready = false
        // Sin una primera conexión, el arranque ya lanzó el error y el hook usa el motor por tramos.
        if (stopping || finished || !connectedOnce) return
        reconnect(`se cerró la conexión (código ${e.code})`)
      }
    })
  }

  /**
   * Abre una conexión nueva con llave nueva; tras varias seguidas, pasa al motor por tramos.
   * `planned` = cambio de idioma pedido por el usuario: no cuenta como falla y no espera. El audio de
   * mientras se guarda en `queue` y se manda al abrir, así no se pierden palabras.
   */
  function reconnect(reason: string, planned = false) {
    if (stopping || reconnecting) return
    let delay = 0
    if (!planned) {
      const times = nextReconnect(reconnectTimes, Date.now())
      if (!times) { fail(`${reason}; demasiadas reconexiones seguidas`); return }
      reconnectTimes = times
      delay = Math.min(4000, 500 * 2 ** (times.length - 1))
    }
    reconnecting = true
    cb.log(`Streaming: ${reason} → ${planned ? 'reabriendo la conexión' : `reconectando (${reconnectTimes.length} en 10 min)`}…`)
    cb.diag?.(planned ? 'lang-switch' : 'reconnect', { reason, n: reconnectTimes.length, audio: tap.state() })
    if (!planned) cb.status?.('reconnecting') // un cambio de idioma no es una falla: sin aviso ámbar
    const old = ws
    ws = null // las respuestas y el cierre de la conexión vieja ya no cuentan
    ready = false
    if (planned && old?.readyState === WebSocket.OPEN) {
      drain(old)
    } else {
      try { old?.close() } catch { /**/ }
      turns.commit() // lo ya reconocido pasa al historial; la conexión nueva empieza de cero
      cb.preview({ text: '', tentative: '' })
      cb.translationPreview?.({ text: '', tentative: '' })
    }
    const reopen = () => {
      if (stopping) { reconnecting = false; return }
      fetchToken(opts.meetingId)
        .then(t => { token = t; return connect() })
        .then(() => {
          reconnecting = false
          cb.log('Streaming: reconectado')
          cb.diag?.('reconnected', { n: reconnectTimes.length })
          cb.status?.(audioStalled ? 'no-audio' : 'ok')
        })
        .catch(err => {
          reconnecting = false
          reconnect(`no se pudo reconectar (${err instanceof Error ? err.message : String(err)})`)
        })
    }
    // Con el reloj del Worker: con la pestaña tapada, setTimeout podía tardar hasta un minuto.
    if (delay) after(delay, reopen)
    else reopen()
  }

  /**
   * Cambio de idioma: la conexión vieja ya no recibe audio (el nuevo va a la cola de la conexión nueva),
   * pero se le pide terminar lo que ya oyó. Sin esto se perdían las palabras que Soniox aún no
   * confirmaba al cortar (medido: 4 de 100 en scripts/test-lang-switch.ts).
   */
  function drain(old: WebSocket) {
    draining = old
    try { old.send(JSON.stringify({ type: 'finalize' })) } catch { /**/ }
    after(DRAIN_MS, () => {
      if (draining === old) draining = null
      try { old.close() } catch { /**/ }
      turns.commit()
    })
  }

  function startWatch() {
    // En el Worker: con la pestaña tapada el vigilante sigue revisando cada segundo (ver utils/ticker).
    stopWatchTicker = every(WATCH_MS, () => {
      if (stopping) return
      const now = Date.now()
      const open = !!ws && ready && ws.readyState === WebSocket.OPEN
      const verdict = watchdog.check(now, open && !reconnecting, ws?.bufferedAmount ?? 0)
      if (verdict === 'no-audio') {
        if (!audioStalled) {
          audioStalled = true
          cb.log(`Audio: dejó de llegar el audio de la reunión (${tap.state()}); intento reanudarlo`)
          cb.diag?.('no-audio', { audio: tap.state() })
          cb.status?.('no-audio')
        }
        void tap.resume()
      } else if (verdict === 'backlog') {
        reconnect(`el audio no sale (${Math.round((ws?.bufferedAmount ?? 0) / 1024)} KB en espera)`)
      } else if (verdict === 'stalled') {
        reconnect(`${Math.round(watchdog.silentFor(now) / 1000)} s sin respuesta de Soniox`)
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
  cb.diag?.('connected', { terms: terms.length, audio: tap.state() })
  startWatch()

  return {
    kind: 'stream',
    setTranslateTo(lang) {
      if (stopping || lang === translateTo) return
      translateTo = lang
      turns.setTarget(lang)
      reconnect(`cambio de idioma de la traducción a ${lang ?? 'ninguno'}`, true)
    },
    stats: () => ({ buffered: ws?.bufferedAmount ?? 0, queued: queue.length, reconnects: reconnectTimes.length, translateFallbacks: turns.fallbacks }),
    async stop() {
      if (stopping) return
      stopping = true
      stopWatch()
      tap.stop()
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'finalize' }))
        ws.send('') // fin del audio: Soniox entrega lo pendiente y responde finished
        const deadline = Date.now() + END_WAIT_MS
        while (!finished && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
      }
      turns.commit()
      try { ws?.close() } catch { /**/ }
      cb.diag?.('stop', { reconnects: reconnectTimes.length })
      cb.preview({ text: '', tentative: '' })
      cb.translationPreview?.({ text: '', tentative: '' })
    },
  }
}
