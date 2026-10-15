// Prueba real del motor en streaming (PRP-003 fase 2) contra Soniox, sin navegador:
//   npx tsx --env-file=.env --env-file=.env.local scripts/test-soniox-stream.ts <audio.wav 16 kHz mono> [es]
// Crea una llave temporal como el servidor, abre el WebSocket como el navegador (llave en los
// protocolos), manda el audio a tiempo real en tramos de 100 ms y mide cuánto tardan en verse
// las palabras (tentativas y finales) y la traducción. Nunca imprime las llaves.
import { readFileSync } from 'node:fs'
import { StreamTurns, sonioxContext, type SonioxMessage } from '../src/features/live/engines/streamEngine'
import { SAP_TERMS } from '../src/features/live/copilot/profile'

const key = process.env.SONIOX_API_KEY
if (!key) { console.error('Falta SONIOX_API_KEY en .env.local'); process.exit(1) }
const wav = readFileSync(process.argv[2])
const translateTo = process.argv[3] ?? 'es'
const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length))
const FRAME = 1600
const median = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN

async function main() {
  const res = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60, client_reference_id: 'prueba-local' }),
  })
  const tmp = await res.json() as { api_key?: string; error_message?: string }
  if (!tmp.api_key) throw new Error(`llave temporal: ${res.status} ${tmp.error_message ?? ''}`)

  const commits: string[] = []
  const turns = new StreamTurns({
    preview: () => {}, translationPreview: () => {}, heard: () => {}, log: () => {}, turnEnd: () => {},
    commit: (t, tr) => commits.push(`${t}\n    → ${tr ?? '(sin traducción)'}`),
    amendTranslation: t => { commits[commits.length - 1] += t },
  }, translateTo)
  const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket', ['soniox-api-key', tmp.api_key])
  ws.binaryType = 'arraybuffer'
  const t0 = { v: 0 }
  const lagTentative: number[] = [], lagFinal: number[] = [], lagTrans: number[] = []
  const seenTentative = new Set<number>()
  let firstTrans = 0
  ws.onmessage = e => {
    const msg = JSON.parse(String(e.data)) as SonioxMessage & { tokens?: { text: string; is_final?: boolean; end_ms?: number; translation_status?: string }[] }
    if (msg.error_code) { console.error('Soniox:', msg.error_code, msg.error_type, msg.error_message); process.exit(1) }
    const now = Date.now() - t0.v
    for (const t of msg.tokens ?? []) {
      if (t.translation_status === 'translation') { if (t.is_final) { lagTrans.push(now); firstTrans ||= now } continue }
      if (t.end_ms === undefined || t.text.startsWith('<')) continue
      if (!t.is_final && !seenTentative.has(t.end_ms)) { seenTentative.add(t.end_ms); lagTentative.push(now - t.end_ms) }
      if (t.is_final) lagFinal.push(now - t.end_ms)
    }
    turns.handle(msg)
    if (msg.finished) {
      turns.commit()
      console.log(`\nPalabras tentativas: retraso mediana ${median(lagTentative)} ms · finales: mediana ${median(lagFinal)} ms (máx. ${Math.max(...lagFinal)} ms)`)
      console.log(`Primera traducción final a los ${firstTrans} ms del inicio (${lagTrans.length} tokens traducidos)`)
      console.log('\nPedazos:\n  ' + commits.join('\n  '))
      process.exit(0)
    }
  }
  ws.onopen = async () => {
    ws.send(JSON.stringify({
      model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1,
      language_hints: ['en', 'es'], enable_language_identification: true, enable_endpoint_detection: true, max_endpoint_delay_ms: 1500,
      context: process.env.CONTEXTO === 'rico' ? sonioxContext([]) : { terms: SAP_TERMS }, translation: { type: 'one_way', target_language: translateTo },
    }))
    t0.v = Date.now()
    for (let i = 0; i < pcm.length; i += FRAME) {
      ws.send(pcm.slice(i, i + FRAME).buffer)
      const wait = t0.v + ((i + FRAME) / 16) - Date.now() // tiempo real
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
    }
    ws.send(JSON.stringify({ type: 'finalize' }))
    ws.send('')
  }
  ws.onerror = () => { console.error('error de conexión'); process.exit(1) }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
