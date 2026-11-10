// Mide el know-how SAP ABAP del Copiloto (PRP-004, fase 1), 10 nov 2026. Llama de verdad a Gemini:
//   npx tsx --env-file=.env.local scripts/test-copilot-knowhow.ts
// 1) cuántos tokens suman instrucciones + know-how; 2) cuánto tarda crear el caché de la reunión;
// 3) primera palabra y respuesta de 3 preguntas generales con caché y sin caché. Nunca imprime llaves.
// La reunión de prueba es inventada (sin datos de clientes).
import { GoogleGenAI } from '@google/genai'
import { COPILOT_SYSTEM, SAP_ABAP_KNOWHOW } from '../src/features/live/copilot/knowhow'
import { GEMINI_MODELS, NO_THINKING } from '../src/lib/geminiModels'

const key = process.env.GEMINI_API_KEY
if (!key) { console.log('Falta GEMINI_API_KEY en el entorno'); process.exit(1) }
const ai = new GoogleGenAI({ apiKey: key })
const model = GEMINI_MODELS.copilot

const MEETING = `MEETING TRANSCRIPT (whole meeting so far):
[00:10] Meeting: Hi Rick, we are reviewing the change for the sales order screen.
[00:42] Meeting: The business wants to block saving an order when the customer has no payment terms.`
const QUESTIONS = [
  'Rick, how do we find which BAdI we can use to validate the sales order before it is saved?',
  'Rick, an inbound order IDoc is in status 51, what do you check first?',
  'Rick, is the classic BAPI for sales orders released for ABAP Cloud?',
]

async function ask(question: string, cacheName: string | null) {
  const t0 = Date.now()
  const text = `${MEETING}\n\nQUESTION TO ANSWER: ${question}`
  const stream = await ai.models.generateContentStream({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: { temperature: 0.3, maxOutputTokens: 500, thinkingConfig: NO_THINKING, ...(cacheName ? { cachedContent: cacheName } : { systemInstruction: COPILOT_SYSTEM }) },
  })
  let first = 0, out = ''
  for await (const c of stream) { if (!first && c.text) first = Date.now() - t0; out += c.text ?? '' }
  return { first, total: Date.now() - t0, out: out.trim() }
}

const tokens = await ai.models.countTokens({ model, contents: [{ role: 'user', parts: [{ text: COPILOT_SYSTEM }] }] })
console.log(`instrucciones + know-how: ${COPILOT_SYSTEM.length} caracteres (know-how ${SAP_ABAP_KNOWHOW.length}) ≈ ${tokens.totalTokens} tokens`)

const t0 = Date.now()
const cache = await ai.caches.create({
  model,
  config: { systemInstruction: COPILOT_SYSTEM, contents: [{ role: 'user', parts: [{ text: 'REFERENCE DOCUMENTS: not in this cache (if there are any, they come with the question).' }] }], ttl: '600s' },
})
console.log(`caché creado en ${Date.now() - t0} ms (${cache.usageMetadata?.totalTokenCount ?? '?'} tokens)`)
try {
  for (const q of QUESTIONS) {
    const c = await ask(q, cache.name ?? null)
    const s = await ask(q, null)
    console.log(`\n• ${q}\n  con caché: primera palabra ${c.first} ms, total ${c.total} ms | sin caché: primera palabra ${s.first} ms`)
    console.log(`  «${c.out.replace(/\n/g, ' ')}»`)
  }
} finally {
  if (cache.name) await ai.caches.delete({ name: cache.name }).catch(() => {})
}
