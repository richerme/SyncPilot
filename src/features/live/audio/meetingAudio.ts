'use client'

// Captura del audio de la reunión para transcribir con la menor espera posible.
//
// Antes: cada 2 s se creaba un MediaRecorder nuevo, se pasaba a base64 y se mandaba
// aunque fuera silencio; el corte fijo partía palabras y siempre había que esperar
// los 2 s completos. Ahora un AudioWorklet (hilo de audio, casi sin CPU) entrega
// tramos de 100 ms a 16 kHz y el audio se corta en las PAUSAS naturales de quien
// habla (o a los 3.5 s si no para), los silencios no se mandan y el fin de turno se
// detecta aquí mismo. Se manda WAV binario (sin base64).

export const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 1600 // 100 ms
const VOICE_RMS = 0.008 // ~ -42 dBFS: el audio de la pestaña en silencio es casi 0
const MIN_CHUNK_FRAMES = 8 // 0.8 s
// Probado con Gemini: una frase entera se transcribe perfecto, pero un corte a media
// frase pierde las palabras de la orilla. Por eso se corta en pausas cortas (0.3 s,
// las de respirar o una coma) y el corte forzado solo llega a los 5 s.
const MAX_CHUNK_FRAMES = 50 // 5 s
const PAUSE_FRAMES = 3 // 0.3 s de pausa → se manda lo acumulado
const TURN_END_FRAMES = 12 // 1.2 s de silencio → terminó su turno
const MIN_VOICED_FRAMES = 3 // menos de 0.3 s de voz = ruido o un clic
const PREROLL_FRAMES = 2 // 0.2 s antes de la voz para no comerse la primera sílaba

const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME_SAMPLES}); this.n = 0 }
  process(inputs) {
    const chans = inputs[0]
    if (chans && chans.length) {
      const len = chans[0].length
      for (let i = 0; i < len; i++) {
        let v = 0
        for (let c = 0; c < chans.length; c++) v += chans[c][i]
        this.buf[this.n++] = v / chans.length
        if (this.n === ${FRAME_SAMPLES}) {
          this.port.postMessage(this.buf, [this.buf.buffer])
          this.buf = new Float32Array(${FRAME_SAMPLES})
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm-tap', PcmTap)
`

export function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

interface Frame { data: Float32Array; level: number }
const isVoiced = (f: Frame) => f.level > VOICE_RMS

/** Corta el audio en pausas. Lógica pura (sin Web Audio) para poder probarla. */
export class SpeechSegmenter {
  private frames: Frame[] = []
  private preroll: Frame[] = []
  private silenceRun = 0
  private inTurn = false

  constructor(
    private onChunk: (pcm: Float32Array) => void,
    private onTurnEnd: () => void,
  ) {}

  push(data: Float32Array) {
    const frame = { data, level: rms(data) }
    if (!this.frames.length && !isVoiced(frame)) {
      this.preroll.push(frame)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
      this.silenceRun++
      if (this.inTurn && this.silenceRun >= TURN_END_FRAMES) {
        this.inTurn = false
        this.onTurnEnd()
      }
      return
    }
    if (!this.frames.length) {
      this.frames = this.preroll
      this.preroll = []
    }
    this.frames.push(frame)
    if (isVoiced(frame)) {
      this.silenceRun = 0
      this.inTurn = true
    } else {
      this.silenceRun++
    }
    const len = this.frames.length
    if (this.silenceRun >= PAUSE_FRAMES && len >= MIN_CHUNK_FRAMES) this.flush()
    else if (len >= MAX_CHUNK_FRAMES) this.cutAtQuietest()
  }

  /** Habla sin pausa: corta en el tramo más bajo del último segundo para no partir una palabra. */
  private cutAtQuietest() {
    let cut = this.frames.length - 1
    for (let i = this.frames.length - 10; i < this.frames.length; i++) {
      if (this.frames[i].level < this.frames[cut].level) cut = i
    }
    const rest = this.frames.slice(cut + 1)
    this.frames = this.frames.slice(0, cut + 1)
    this.flush()
    this.frames = rest
  }

  /** Manda lo que haya (también al terminar la sesión). */
  flush() {
    if (this.frames.filter(isVoiced).length >= MIN_VOICED_FRAMES) {
      const out = new Float32Array(this.frames.length * FRAME_SAMPLES)
      this.frames.forEach((f, i) => out.set(f.data, i * FRAME_SAMPLES))
      this.onChunk(out)
    }
    this.frames = []
  }
}

/** WAV PCM 16 bits mono. */
export function encodeWav(pcm: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Entrega resultados en el orden en que se pidieron aunque las respuestas lleguen
 * desordenadas (dos transcripciones en paralelo pueden volver al revés).
 */
export class OrderedDelivery<T> {
  private nextSeq = 0
  private issued = 0
  private ready = new Map<number, T>()
  constructor(private deliver: (value: T) => void) {}
  ticket(): number { return this.issued++ }
  resolve(seq: number, value: T) {
    this.ready.set(seq, value)
    while (this.ready.has(this.nextSeq)) {
      const v = this.ready.get(this.nextSeq) as T
      this.ready.delete(this.nextSeq)
      this.nextSeq++
      this.deliver(v)
    }
  }
}

export interface MeetingAudioTap { stop: () => void }

/** Conecta el stream de la reunión al worklet y pasa cada tramo de 100 ms al segmentador. */
export async function startMeetingAudioTap(stream: MediaStream, segmenter: SpeechSegmenter): Promise<MeetingAudioTap> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const source = ctx.createMediaStreamSource(stream)
  const tap = new AudioWorkletNode(ctx, 'pcm-tap')
  // Salida en silencio hacia el destino: garantiza que el navegador procese el nodo.
  const mute = ctx.createGain()
  mute.gain.value = 0
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => segmenter.push(e.data)
  source.connect(tap)
  tap.connect(mute).connect(ctx.destination)
  return {
    stop() {
      tap.port.onmessage = null
      try { source.disconnect() } catch { /**/ }
      segmenter.flush()
      ctx.close().catch(() => {})
    },
  }
}
