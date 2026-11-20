// Cambio de idioma de la traducción a media reunión (PRP-005, fase 2), contra Soniox real, sin navegador:
//   npx tsx --env-file=.env --env-file=.env.local scripts/test-lang-switch.ts <audio.wav 16 kHz mono> [segundo del cambio] [idioma inicial] [idioma nuevo]
// Hace lo mismo que el motor (engines/streamEngine.ts → setTranslateTo): manda el audio a tiempo real,
// en el segundo indicado cierra la conexión, guarda el audio mientras se abre otra con el idioma nuevo
// y lo manda al abrir. Mide cuánto tarda en reabrir, cuánto en volver a verse palabras y traducción,
// y si se perdieron palabras. Nunca imprime las llaves.
import { readFileSync } from 'node:fs'
import { SAP_TERMS } from '../src/features/live/copilot/profile'

const key = process.env.SONIOX_API_KEY
if (!key) { console.error('Falta SONIOX_API_KEY en .env.local'); process.exit(1) }
const wav = readFileSync(process.argv[2])
const switchAt = Number(process.argv[3] ?? 12) * 1000
const firstLang = process.argv[4] ?? 'es'
const secondLang = process.argv[5] ?? 'fr'
const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length))
const FRAME = 1600 // 100 ms
const totalMs = (pcm.length / 16000) * 1000

interface Token { text: string; is_final?: boolean; translation_status?: string; language?: string }

async function tempKey(): Promise<string> {
  const res = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60, client_reference_id: 'prueba-cambio-idioma' }),
  })
  const j = await res.json() as { api_key?: string; error_message?: string }
  if (!j.api_key) throw new Error(`llave temporal: ${res.status} ${j.error_message ?? ''}`)
  return j.api_key
}

function config(lang: string) {
  return {
    model: process.env.SONIOX_MODEL ?? 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
    language_hints: ['en', 'es'], enable_language_identification: true, enable_endpoint_detection: true, max_endpoint_delay_ms: 1500,
    context: { terms: SAP_TERMS }, translation: { type: 'one_way', target_language: lang },
  }
}

async function main() {
  const t0 = Date.now()
  const at = () => Date.now() - t0
  let ws: WebSocket | null = null
  let draining: WebSocket | null = null
  let ready = false
  const queue: ArrayBuffer[] = []
  const finals: string[] = []
  const transLangs = new Map<string, number>() // idioma de la traducción → tokens finales
  let switchedAt = 0, reopenedAt = 0, firstWordAfter = 0, firstTransAfter = 0

  async function open(lang: string, phase: 1 | 2) {
    const apiKey = await tempKey()
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket', ['soniox-api-key', apiKey])
      socket.binaryType = 'arraybuffer'
      ws = socket
      socket.onopen = () => {
        socket.send(JSON.stringify(config(lang)))
        for (const b of queue.splice(0)) socket.send(b)
        ready = true
        resolve()
      }
      socket.onerror = () => reject(new Error('error de conexión'))
      socket.onmessage = (e: MessageEvent) => {
        if (ws !== socket && draining !== socket) return
        const msg = JSON.parse(String(e.data)) as { tokens?: Token[]; error_message?: string }
        if (msg.error_message) console.log(`  Soniox: ${msg.error_message}`)
        for (const t of msg.tokens ?? []) {
          if (t.text === '<end>' || t.text === '<fin>') continue
          const isTrans = t.translation_status === 'translation'
          if (phase === 2 && !isTrans && !firstWordAfter) firstWordAfter = at()
          if (phase === 2 && isTrans && !firstTransAfter) firstTransAfter = at()
          if (!t.is_final) continue
          if (isTrans) transLangs.set(`${phase}:${t.language ?? '?'}`, (transLangs.get(`${phase}:${t.language ?? '?'}`) ?? 0) + 1)
          else finals.push(t.text)
        }
      }
    })
  }

  await open(firstLang, 1)
  for (let off = 0, i = 0; off < pcm.length; off += FRAME, i++) {
    const target = i * 100
    const wait = target - at()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    if (!switchedAt && target >= switchAt) {
      // Cambio de idioma: igual que reconnect(…, planned=true) del motor.
      switchedAt = at()
      ready = false
      const old = ws as WebSocket | null
      ws = null
      // Igual que drain(): la conexión vieja termina de entregar lo que ya oyó.
      draining = old
      try { old?.send(JSON.stringify({ type: 'finalize' })) } catch { /**/ }
      setTimeout(() => { draining = null; try { old?.close() } catch { /**/ } }, 2500)
      void open(secondLang, 2).then(() => { reopenedAt = at() })
    }
    const buf = pcm.slice(off, off + FRAME).buffer
    if (ready && ws && (ws as WebSocket).readyState === WebSocket.OPEN) (ws as WebSocket).send(buf)
    else queue.push(buf)
  }
  const sock = ws as WebSocket | null
  sock?.send('')
  await new Promise(r => setTimeout(r, 4000))
  sock?.close()

  const words = finals.join('').trim().split(/\s+/).filter(Boolean).length
  console.log(`Audio: ${(totalMs / 1000).toFixed(1)} s · cambio de ${firstLang} a ${secondLang} en el segundo ${(switchedAt / 1000).toFixed(1)}`)
  console.log(`Reabrir la conexión (llave + WebSocket): ${reopenedAt - switchedAt} ms`)
  console.log(`Primera palabra después del cambio: ${firstWordAfter - switchedAt} ms · primera traducción: ${firstTransAfter - switchedAt} ms`)
  console.log(`Traducción por fase e idioma (tokens finales): ${[...transLangs].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  console.log(`Palabras transcritas en total: ${words}`)
  console.log(`Texto completo:\n${finals.join('').trim()}`)
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
