// Pruebas de «Investigar» del Copiloto (src/lib/copilotResearch.ts), PRP-004 fase 2, 10 nov 2026.
//   npx tsx scripts/test-copilot-research.ts             → sin red: lo que sale a internet, parsers y respaldo
//   npx tsx --env-file=.env.local scripts/test-copilot-research.ts --real 10
//        → además N llamadas reales (reescribir con Gemini + Google Search): latencia, búsquedas y costo.
//   … --real-contexto 4 → «Investigar» libre (PRP-005) real: idioma de la reunión, últimos puntos y búsqueda en ese idioma.
// Todos los nombres de la reunión de prueba son INVENTADOS (ningún dato de clientes). Nunca imprime llaves.
import { GoogleGenAI } from '@google/genai'
import {
  scrubQuery, blockedTermsFrom, parseRewrite, parseGeminiGrounding, parseOpenRouterSearch, runResearch,
  rewriteUserPrompt, geminiRewriteStep, geminiSearchStep, NothingToSearchError, type SearchOutcome, type Step,
  parseContext, runContextSummary, runQuerySearch, languageName, searchSystem, geminiContextStep,
} from '../src/lib/copilotResearch'
import { SAP_ABAP_KNOWHOW } from '../src/features/live/copilot/knowhow'
import { SAP_TERMS } from '../src/features/live/copilot/profile'

let failures = 0
function check(ok: boolean, label: string) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failures++ }

const VOCAB = `${SAP_ABAP_KNOWHOW}\n${SAP_TERMS.join('\n')}`
// Reunión inventada: empresa, personas, sistema, objeto Z y ticket que NO deben salir a internet.
const FAKE = { company: 'Grupo Ficticio Norte', person: 'Laura Méndez', zobj: 'ZSD_FICT_CHECK', sid: 'FNP-300', ticket: '4500098765', project: 'Proyecto Alba' }
const TERMS = [FAKE.company, FAKE.person, FAKE.zobj, FAKE.project, 'VA01', 'ABAP Cloud', 'BAdI', 'sales order', 'FNP']
const TRANSCRIPT = `[12:01] Meeting: ${FAKE.person} from ${FAKE.company} here. In ${FAKE.sid} the report ${FAKE.zobj} fails on save, ticket ${FAKE.ticket}.
[12:02] Meeting: Rick, for ${FAKE.project}, is the sales order BAdI we use released for ABAP Cloud in S/4HANA 2023?`
const leaks = (q: string) => [FAKE.company, FAKE.person, FAKE.zobj, FAKE.sid, FAKE.ticket, FAKE.project, 'Laura', 'Ficticio', 'FNP'].filter(s => q.toLowerCase().includes(s.toLowerCase()))

async function sinRed() {
  const blocked = blockedTermsFrom(TERMS, VOCAB)
  check([FAKE.company, FAKE.person, FAKE.zobj, FAKE.project, 'FNP'].every(t => blocked.includes(t)), `términos propios bloqueados: ${blocked.join(', ')}`)
  check(!blocked.includes('VA01') && !blocked.includes('ABAP Cloud') && !blocked.includes('BAdI') && !blocked.includes('sales order'), 'los términos de SAP estándar se quedan (VA01, ABAP Cloud, BAdI, sales order)')

  const dirty = `Does ${FAKE.company}'s ${FAKE.zobj} in ${FAKE.sid} for ${FAKE.person} (ticket ${FAKE.ticket}, mail laura@ficticio.example) need a released BAdI for VA01 in ABAP Cloud?`
  const s = scrubQuery(dirty, blocked)
  check(leaks(s.query).length === 0, `el filtro fijo quita nombres, objeto Z, SID, ticket y correo → «${s.query}»`)
  check(/VA01/.test(s.query) && /ABAP Cloud/.test(s.query) && /BAdI/.test(s.query), 'y conserva VA01, ABAP Cloud y BAdI')

  check(parseRewrite('{"query":"Is BAPI_SALESORDER_CREATEFROMDAT2 released for ABAP Cloud?"}') === 'Is BAPI_SALESORDER_CREATEFROMDAT2 released for ABAP Cloud?', 'lee el JSON de la reescritura')
  check(parseRewrite('no es json') === '', 'reescritura ilegible → vacía')

  // El paso de búsqueda recibe SOLO la pregunta limpia, aunque el modelo de reescritura «se equivoque».
  let sentToSearch = '', sentToRewrite = ''
  const leakyRewrite: Step<string, string> = { name: 'falso', run: async (p) => { sentToRewrite = p; return JSON.stringify({ query: `Is the BAdI used by ${FAKE.company} in ${FAKE.zobj} released for ABAP Cloud in S/4HANA 2023?` }) } }
  const fakeSearch: Step<string, SearchOutcome> = { name: 'busca-falso', run: async (q) => { sentToSearch = q; return { text: 'ok', sources: [], searchQueries: [q], suggestionsHtml: '' } } }
  const r = await runResearch({ question: null, firstAnswer: 'I will confirm it.', transcriptTail: TRANSCRIPT, blockedTerms: blocked }, { rewrite: [leakyRewrite], search: [fakeSearch] })
  check(sentToRewrite.includes(FAKE.person), 'la reescritura sí ve el contexto de la reunión (para entender la pregunta)')
  check(leaks(sentToSearch).length === 0 && !sentToSearch.includes('[12:0'), `a la búsqueda solo llega la pregunta limpia → «${sentToSearch}»`)
  check(r.removed.length > 0, `y dice qué quitó: ${r.removed.join(', ')}`)

  const vacia: Step<string, string> = { name: 'falso', run: async () => '{"query":""}' }
  let nada = false
  try { await runResearch({ question: '¿Cuándo entregas?', firstAnswer: '', transcriptTail: '', blockedTerms: [] }, { rewrite: [vacia], search: [fakeSearch] }) } catch (e) { nada = e instanceof NothingToSearchError }
  check(nada, 'pregunta solo del proyecto → no busca nada')

  const cae: Step<string, SearchOutcome> = { name: 'Gemini + Google Search', run: async () => { const e = new Error('Your prepayment credits are depleted') as Error & { status?: number }; e.status = 402; throw e } }
  const r2 = await runResearch({ question: 'q', firstAnswer: '', transcriptTail: '', blockedTerms: [] }, { rewrite: [{ name: 'f', run: async () => '{"query":"How to debug an inbound IDoc in status 51"}' }], search: [cae, fakeSearch] })
  check(r2.provider === 'busca-falso' && r2.failures[0]?.kind === 'sin_saldo', 'si Gemini se queda sin saldo, busca el respaldo')

  const g = parseGeminiGrounding({ text: ' Respuesta ', candidates: [{ groundingMetadata: {
    webSearchQueries: ['a', 'b'],
    groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/x1', title: 'sap.com' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/x1', title: 'sap.com' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/x2', title: 'community.sap.com' } }],
    searchEntryPoint: { renderedContent: '<div>chips</div>' } } }] })
  check(g.text === 'Respuesta' && g.sources.length === 2 && g.sources[1].domain === 'community.sap.com' && g.suggestionsHtml === '<div>chips</div>' && g.searchQueries.length === 2, 'lee el grounding de Gemini (fuentes sin repetir, dominio, sugerencias)')
  const o = parseOpenRouterSearch({ choices: [{ message: { content: 'R', annotations: [{ type: 'url_citation', url_citation: { url: 'https://help.sap.com/docs/x', title: 'Help' } }] } }] })
  check(o.text === 'R' && o.sources[0]?.domain === 'help.sap.com', 'lee las citas del plugin web de OpenRouter')
}

// «Investigar» libre (PRP-005): reunión inventada en español; lo último es un IDoc en estado 51.
const TRANSCRIPT_ES = `[10:00] Meeting: ${FAKE.person} de ${FAKE.company}: primero el estatus, el reporte de ventas va en pruebas.
[10:03] Meeting: Rick, lo de las fechas lo vemos el jueves con ${FAKE.project}.
[10:07] Meeting: Ahora lo urgente: en ${FAKE.sid} los IDocs de pedidos entrantes se quedan en estado 51 y la función ${FAKE.zobj} marca error de socio.
[10:08] Meeting: ¿Cómo revisamos por qué el IDoc queda en 51 y lo reprocesamos sin duplicar el pedido?`

async function contexto() {
  const blocked = blockedTermsFrom(TERMS, VOCAB)
  const p = parseContext('{"language":"es","points":["Se habla de IDocs en estado 51.","  ","Quieren reprocesar sin duplicar."],"query":"How to reprocess an inbound IDoc in status 51?"}')
  check(p.language === 'es' && p.points.length === 2 && p.query.startsWith('How'), 'lee el JSON del contexto (idioma, puntos sin vacíos, pregunta)')
  check(parseContext('nada').points.length === 0 && parseContext('nada').language === 'en', 'contexto ilegible → sin puntos, inglés')
  check(languageName('es') === 'Spanish' && languageName('pt-BR') === 'Portuguese' && languageName('xx') === 'English', 'nombre del idioma para el modelo (es, pt-BR, desconocido)')
  check(searchSystem('es').includes('in Spanish') && !searchSystem('es').includes('in English'), 'la búsqueda contesta en el idioma de la reunión')

  // El modelo «se equivoca» y deja datos del cliente en la pregunta: el filtro fijo los quita; los puntos (solo para el usuario) quedan.
  let seen = ''
  const leaky: Step<string, string> = { name: 'falso', run: async (prompt) => { seen = prompt; return JSON.stringify({
    language: 'es', points: [`${FAKE.person} pregunta por IDocs en estado 51 en ${FAKE.sid}.`, 'Quieren reprocesar sin duplicar el pedido.'],
    query: `How does ${FAKE.company} reprocess inbound IDocs in status 51 with ${FAKE.zobj} in ${FAKE.sid}?`,
  }) } }
  const c = await runContextSummary(TRANSCRIPT_ES, blocked, [leaky])
  check(seen.includes('estado 51') && seen.indexOf('estado 51') > seen.indexOf('estatus'), 'el resumen ve la reunión con lo último al final')
  check(c.language === 'es' && c.points.length === 2, 'regresa el idioma y los puntos tal cual')
  check(leaks(c.query).length === 0 && /IDoc/.test(c.query), `la pregunta para internet sale limpia → «${c.query}»`)

  const soloProyecto: Step<string, string> = { name: 'falso', run: async () => '{"language":"es","points":["Se habló de fechas."],"query":""}' }
  check((await runContextSummary('[10:00] Meeting: ¿Cuándo entregas?', blocked, [soloProyecto])).query === '', 'solo temas del proyecto → no hay pregunta para internet')

  let sent = ''
  const fakeSearch: Step<string, SearchOutcome> = { name: 'busca-falso', run: async (q) => { sent = q; return { text: 'ok', sources: [], searchQueries: [q], suggestionsHtml: '' } } }
  await runQuerySearch(`Reprocess IDoc status 51 for ${FAKE.company} ${FAKE.zobj}`, blocked, [fakeSearch])
  check(leaks(sent).length === 0, `la búsqueda vuelve a filtrar lo que manda el navegador → «${sent}»`)
  let nada = false
  try { await runQuerySearch(FAKE.company, blocked, [fakeSearch]) } catch (e) { nada = e instanceof NothingToSearchError }
  check(nada, 'si después de filtrar no queda pregunta, no busca')
}

async function realContexto(n: number) {
  const key = process.env.GEMINI_API_KEY
  if (!key) { console.log('  (--real-contexto necesita GEMINI_API_KEY)'); failures++; return }
  const ai = new GoogleGenAI({ apiKey: key })
  const blocked = blockedTermsFrom(TERMS, VOCAB)
  const cases = [
    { name: 'español, IDoc al final', transcript: TRANSCRIPT_ES, lang: 'es', topic: /idoc|51/i },
    { name: 'inglés, BAdI al final', transcript: TRANSCRIPT, lang: 'en', topic: /badi|abap cloud|sales order/i },
  ]
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const k = cases[i % cases.length]
    try {
      const c = await runContextSummary(k.transcript, blocked, [geminiContextStep(ai)])
      ms.push(c.ms)
      const l = leaks(c.query)
      check(c.language === k.lang && c.points.length >= 2 && k.topic.test(c.points.join(' ')) && l.length === 0,
        `${i + 1}. ${k.name}: ${c.ms} ms · ${c.language} · ${c.points.length} puntos · «${c.query}»${l.length ? ` FUGA: ${l.join(', ')}` : ''}`)
      console.log(`     ${c.points.map(x => `• ${x}`).join('\n     ')}`)
      if (c.query) {
        const r = await runQuerySearch(c.query, blocked, [geminiSearchStep(ai, c.language)])
        const spanish = /\b(el|la|los|las|que|para|con)\b/i.test(r.text)
        check(k.lang === 'es' ? spanish : !spanish, `   búsqueda en ${r.ms.search} ms, contestada en ${k.lang === 'es' ? 'español' : 'inglés'} · ${r.sources.length} fuentes`)
      }
    } catch (e) { check(false, `${i + 1}. falló: ${e instanceof Error ? e.message.slice(0, 120) : e}`) }
  }
  if (ms.length) console.log(`\nResumen (sin internet), n=${ms.length}: p50 ${pct(ms, 0.5)} ms / p90 ${pct(ms, 0.9)} ms`)
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]

async function real(n: number) {
  const key = process.env.GEMINI_API_KEY
  if (!key) { console.log('  (--real necesita GEMINI_API_KEY)'); failures++; return }
  const ai = new GoogleGenAI({ apiKey: key })
  const blocked = blockedTermsFrom(TERMS, VOCAB)
  const questions = [
    null, 'Is the BAPI for sales orders released for ABAP Cloud?', 'What replaced KONV for pricing conditions in S/4HANA?',
    'How do I find the right BAdI for VA01 save?', 'Which transaction monitors bgRFC queues?', 'Is MATDOC used instead of MSEG in S/4HANA 2023?',
    'What is the successor of CL_GUI_ALV_GRID in ABAP Cloud?', 'How do I debug an inbound IDoc in status 51?',
    'Does S/4HANA 2023 support CDS DDIC-based views for new development?', 'What is the clean core level of implicit enhancements?',
  ]
  // Mide el paso 2 tal cual va en la ruta; el paso 1 ve la reunión inventada.
  const search = geminiSearchStep(ai)
  let searches = 0, inTok = 0, outTok = 0
  const rewriteMs: number[] = [], searchMs: number[] = [], totalMs: number[] = []
  const countingSearch: Step<string, SearchOutcome> = { name: search.name, run: async (q) => {
    const out = await search.run(q); searches += out.searchQueries.length; return out } }
  for (let i = 0; i < n; i++) {
    const question = questions[i % questions.length]
    try {
      const r = await runResearch({ question, firstAnswer: 'I will confirm it in the system.', transcriptTail: TRANSCRIPT, blockedTerms: blocked }, { rewrite: [geminiRewriteStep(ai)], search: [countingSearch] })
      rewriteMs.push(r.ms.rewrite); searchMs.push(r.ms.search); totalMs.push(r.ms.rewrite + r.ms.search)
      const l = leaks(r.query)
      check(l.length === 0, `${i + 1}. ${r.ms.rewrite}+${r.ms.search} ms · ${r.searchQueries.length} búsquedas · ${r.sources.length} fuentes · «${r.query}»${l.length ? ` FUGA: ${l.join(', ')}` : ''}`)
    } catch (e) { check(false, `${i + 1}. falló: ${e instanceof Error ? e.message.slice(0, 120) : e}`) }
  }
  // Tokens del paso 2 de una llamada más (para el costo por tokens).
  const u = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: 'How do I debug an inbound IDoc in status 51?', config: { tools: [{ googleSearch: {} }], maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } })
  inTok = u.usageMetadata?.promptTokenCount ?? 0; outTok = u.usageMetadata?.candidatesTokenCount ?? 0
  const perSearch = searches / Math.max(1, totalMs.length)
  console.log(`\nLatencia (n=${totalMs.length}): reescribir p50 ${pct(rewriteMs, 0.5)} / p90 ${pct(rewriteMs, 0.9)} ms · buscar p50 ${pct(searchMs, 0.5)} / p90 ${pct(searchMs, 0.9)} ms · total p50 ${pct(totalMs, 0.5)} / p90 ${pct(totalMs, 0.9)} ms`)
  console.log(`Búsquedas de Google por clic: ${perSearch.toFixed(1)} (total ${searches}) · tokens de una búsqueda: ${inTok} entrada / ${outTok} salida`)
  console.log(`Costo por clic: ${perSearch.toFixed(1)} × 14 USD / 1,000 = ${(perSearch * 0.014).toFixed(3)} USD después de las 5,000 búsquedas gratis al mes; tokens ≈ ${(((inTok + 300) * 0.75 + (outTok + 60) * 3.75) / 1e6).toFixed(4)} USD`)
}

await sinRed()
await contexto()
const i = process.argv.indexOf('--real')
if (i > 0) await real(Number(process.argv[i + 1]) || 10)
const j = process.argv.indexOf('--real-contexto')
if (j > 0) await realContexto(Number(process.argv[j + 1]) || 4)
console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(failures ? 1 : 0)
