// Pruebas del respaldo del Copiloto (src/lib/copilotAnswer.ts), 10 nov 2026.
//   npx tsx scripts/test-copilot-fallback.ts            → sin red: clasificación de errores y orden de proveedores
//   npx tsx --env-file=.env.local scripts/test-copilot-fallback.ts --real
//        → además llama de verdad a Gemini (como la ruta de antes, solo Gemini) y a la cadena nueva
//          Gemini → OpenRouter con las llaves de .env.local. Nunca imprime las llaves.
import { GoogleGenAI } from '@google/genai'
import { classifyAiError, openWithFallback, chatCompletionStream, CopilotUnavailableError, friendlyCopilotError, type CopilotProvider } from '../src/lib/copilotAnswer'

let failures = 0
const check = (ok: boolean, label: string) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++ }
const gen = (...parts: string[]) => async () => (async function* () { for (const p of parts) yield p })()
const fails = (err: unknown) => async (): Promise<AsyncIterable<string>> => { throw err }
const failsOnFirstRead = (err: unknown) => async () => (async function* (): AsyncGenerator<string> { throw err })()
const http = (status: number, message: string) => Object.assign(new Error(message), { status })
const drain = async (it: AsyncIterator<string>) => { let s = ''; for (;;) { const r = await it.next(); if (r.done) return s; s += r.value } }

async function sinRed() {
  // 1) Clasificación: el error real del 9-10 nov fue un 402 «prepayment credits are depleted».
  check(classifyAiError(http(402, 'Your prepayment credits are depleted.')) === 'sin_saldo', '402 de Gemini = sin saldo')
  check(classifyAiError(new Error('{"error":{"code":402,"status":"RESOURCE_EXHAUSTED","message":"Your prepayment credits are depleted"}}')) === 'sin_saldo', 'el texto del SDK sin status también se reconoce como sin saldo')
  check(classifyAiError(http(429, 'Too many requests')) === 'cupo', '429 = cupo')
  check(classifyAiError(http(401, 'API key not valid')) === 'llave', '401 = llave')
  check(classifyAiError(http(404, 'models/x is not found')) === 'modelo', '404 = modelo')
  check(classifyAiError(new TypeError('fetch failed')) === 'red', 'fetch failed = red')

  // 2) Como era antes: solo Gemini y con 402 → no hay respuesta.
  let antes: unknown = null
  try { await openWithFallback([{ name: 'Gemini', open: fails(http(402, 'Your prepayment credits are depleted.')) }]) } catch (e) { antes = e }
  check(antes instanceof CopilotUnavailableError, 'solo Gemini con 402: falla (lo que veía el usuario)')
  check(antes instanceof CopilotUnavailableError && /sin saldo/.test(antes.message) && /Recarga/.test(antes.message), 'el mensaje dice que se quedó sin saldo y qué hacer')

  // 3) Con respaldo: Gemini falla al abrir → contesta OpenRouter, y el texto llega completo.
  const a = await openWithFallback([{ name: 'Gemini', open: fails(http(402, 'depleted')) }, { name: 'OpenRouter', open: gen('', 'Yes, ', 'I can ', 'check it.') }])
  check(a.provider === 'OpenRouter' && a.failures.length === 1 && a.failures[0].kind === 'sin_saldo', 'Gemini 402 → responde OpenRouter')
  check(a.first + await drain(a.rest) === 'Yes, I can check it.', 'el texto llega completo (los pedazos vacíos del inicio se saltan)')

  // 4) Gemini falla al leer el primer pedazo (no al abrir) → también cae al respaldo.
  const b = await openWithFallback([{ name: 'Gemini', open: failsOnFirstRead(http(429, 'quota')) }, { name: 'OpenRouter', open: gen('OK') }])
  check(b.provider === 'OpenRouter' && b.failures[0].kind === 'cupo', 'error en el primer pedazo → respaldo')

  // 5) Gemini sano → no se toca el respaldo.
  let usadoRespaldo = false
  const c = await openWithFallback([{ name: 'Gemini', open: gen('Hi') }, { name: 'OpenRouter', open: async () => { usadoRespaldo = true; return gen('x')() } }])
  check(c.provider === 'Gemini' && !usadoRespaldo, 'con Gemini sano no se llama al respaldo')

  // 6) Los dos fallan → error con los dos motivos.
  let d: unknown = null
  try { await openWithFallback([{ name: 'Gemini', open: fails(http(402, 'x')) }, { name: 'OpenRouter', open: fails(http(401, 'x')) }]) } catch (e) { d = e }
  check(d instanceof CopilotUnavailableError && /Gemini: la cuenta de IA se quedó sin saldo; OpenRouter: la llave/.test((d as Error).message), 'los dos fallan → dice qué pasó con cada uno')
  check(friendlyCopilotError([]) === 'No hay ningún proveedor de IA configurado.', 'sin proveedores → mensaje claro')

  // 7) Parser del stream de OpenRouter (SSE) con un fetch simulado.
  const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n: comentario\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
  const fakeFetch = (async () => new Response(sse, { status: 200 })) as typeof fetch
  let out = ''
  for await (const t of chatCompletionStream({ url: 'x', apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl: fakeFetch })) out += t
  check(out === 'Hello', 'el parser SSE junta los pedazos')
  const fake402 = (async () => new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 })) as typeof fetch
  let e402: unknown = null
  try { for await (const _ of chatCompletionStream({ url: 'x', apiKey: 'k', model: 'm', system: 's', user: 'u', fetchImpl: fake402 })) { /* nada */ } } catch (e) { e402 = e }
  check(classifyAiError(e402) === 'sin_saldo', 'un 402 de OpenRouter también se clasifica como sin saldo')
}

async function real() {
  const geminiKey = process.env.GEMINI_API_KEY, orKey = process.env.OPENROUTER_API_KEY
  if (!geminiKey || !orKey) { console.log('  (--real necesita GEMINI_API_KEY y OPENROUTER_API_KEY en el entorno)'); failures++; return }
  const ai = new GoogleGenAI({ apiKey: geminiKey })
  const system = 'You are Rick, an SAP ABAP consultant. Answer in one short sentence.'
  const user = 'QUESTION TO ANSWER: What is a BAdI?'
  const gemini: CopilotProvider = {
    name: 'Gemini',
    open: async () => {
      const r = await ai.models.generateContentStream({ model: 'gemini-3.5-flash', contents: [{ role: 'user', parts: [{ text: user }] }], config: { temperature: 0.3, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 }, systemInstruction: system } })
      return (async function* () { for await (const ch of r) yield ch.text ?? '' })()
    },
  }
  const openRouter: CopilotProvider = {
    name: 'OpenRouter',
    open: async () => chatCompletionStream({ url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: orKey, model: process.env.OPENROUTER_COPILOT_MODEL ?? 'google/gemini-2.5-flash', system, user, maxTokens: 200 }),
  }
  // Antes: solo Gemini.
  try {
    const o = await openWithFallback([gemini])
    console.log(`  solo Gemini: contestó («${(o.first + await drain(o.rest)).slice(0, 60)}»)`)
  } catch (e) {
    console.log(`  solo Gemini: ${e instanceof CopilotUnavailableError ? e.failures.map(f => f.kind).join(',') : 'error'} → ${(e as Error).message}`)
  }
  // Ahora: Gemini → OpenRouter.
  const t0 = Date.now()
  const o = await openWithFallback([gemini, openRouter])
  const texto = o.first + await drain(o.rest)
  check(texto.trim().length > 10, `cadena nueva: contestó ${o.provider} en ${Date.now() - t0} ms («${texto.slice(0, 60).replace(/\n/g, ' ')}»)${o.failures.length ? ` · falló ${o.failures.map(f => `${f.provider} ${f.kind}`).join(', ')}` : ''}`)
}

await sinRed()
if (process.argv.includes('--real')) await real()
console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(failures ? 1 : 0)
