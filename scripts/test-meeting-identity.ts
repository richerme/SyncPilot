// Pruebas de «qué reunión es esta» (src/lib/meetingIdentity.ts), 10 nov 2026.
// Pedido del usuario: un documento de estatus trae a varios clientes, cada uno con la fecha y hora de su
// reunión; el Copiloto debe usar solo la entrada de la reunión actual (fecha y hora; si no, el cliente del
// título o lo que se dice) y no mezclar tareas de otros clientes.
//   node --env-file=.env --env-file=.env.local ../Echo-Speak/node_modules/tsx/dist/cli.mjs scripts/test-meeting-identity.mts [--real]
//   (copiar a .mts; SyncPilot no tiene tsx). --real llama a Gemini con el prompt real del Copiloto.
// Los clientes y tareas son inventados: nunca datos reales de clientes en las pruebas.
import { GoogleGenAI } from '@google/genai'
import { COPILOT_SYSTEM } from '../src/features/live/copilot/knowhow'
import { GEMINI_MODELS, NO_THINKING } from '../src/lib/geminiModels'
import { describeMeeting, meaningfulTitle, copilotConversation } from '../src/lib/meetingIdentity'

let failures = 0
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures++ }

// 16:00 UTC = 10:00 en Ciudad de México (sin horario de verano desde 2022).
const AT_10 = new Date('2026-11-10T16:00:00Z')
function sinRed() {
  check(meaningfulTitle('Reunión 10/11/2026') === null, 'el título automático no cuenta como cliente')
  check(meaningfulTitle('  Globex Sur · estatus ') === 'Globex Sur · estatus', 'un título escrito sí cuenta')
  const d = describeMeeting({ title: null, startedAt: AT_10 }, 'America/Mexico_City')
  check(d.includes('2026-11-10') && d.includes('10/11/2026') && d.includes('martes') && d.includes('Tuesday'), 'la fecha va en varios formatos (ISO, dd/mm/aaaa, español e inglés)')
  check(d.includes('Started at: 10:00'), `la hora es la de Ciudad de México («${d.split('\n')[3]}»)`)
  check(d.includes('identify the client from the transcript'), 'sin título, le dice que identifique al cliente por la conversación')
  const c = copilotConversation({ meeting: { title: 'Globex Sur', startedAt: AT_10 }, brief: '• algo', transcript: 'Meeting: hola', trigger: 'button', ask: 'status?' })
  check(c.startsWith('THIS MEETING') && c.includes('Title: "Globex Sur"') && c.includes('follow THIS MEETING'), 'la conversación empieza con THIS MEETING y el resumen cede ante ella')
  check(COPILOT_SYSTEM.includes('Never mix tasks, dates, owners or status from other clients'), 'la regla de varios clientes está en las instrucciones del caché')
}

const DOC = `===== DOCUMENT: estatus-reuniones.docx =====
ESTATUS DE REUNIONES (notas de Rick)

Cliente: Acme Norte | Reunión: 03/11/2026 10:00
- Reporte ZSD_PRICING_CHECK: especificación funcional aprobada; arranca el desarrollo.

Cliente: Acme Norte | Reunión: 10/11/2026 10:00
- Reporte ZSD_PRICING_CHECK: desarrollo terminado; faltan las pruebas unitarias, se entregan el jueves.

Cliente: Globex Sur | Reunión: 10/11/2026 16:00
- Interfaz de pedidos IDoc ORDERS05: mapeo detenido, esperamos la especificación funcional del cliente.`

async function real() {
  const key = process.env.GEMINI_API_KEY
  if (!key) { console.log('  (--real necesita GEMINI_API_KEY)'); failures++; return }
  const ai = new GoogleGenAI({ apiKey: key })
  const casos = [
    { n: 'fecha y hora coinciden (Acme 10:00)', meeting: { title: 'Reunión 10/11/2026', startedAt: AT_10 },
      transcript: '[00:40] Meeting: Hi Rick, thanks for joining.\n[01:10] Meeting: Rick, what is the status of your task?', si: /unit test|thursday/i, no: /idoc|orders05|mapping/i },
    { n: 'sin fecha que coincida, por el cliente del título (Globex)', meeting: { title: 'Globex Sur · estatus', startedAt: new Date('2026-11-12T15:00:00Z') },
      transcript: '[00:30] Meeting: Good morning.\n[01:05] Meeting: Rick, where are we with your task?', si: /idoc|orders05|mapping|functional spec/i, no: /pricing|unit test/i },
    { n: 'sin fecha ni título, por lo que se dice (Globex)', meeting: { title: 'Reunión 12/11/2026', startedAt: new Date('2026-11-12T15:00:00Z') },
      transcript: '[00:20] Meeting: Hi everyone, this is the Globex weekly call about the orders interface.\n[01:00] Meeting: Rick, any update on your side?', si: /idoc|orders05|mapping|functional spec/i, no: /pricing|unit test/i },
  ]
  for (const c of casos) {
    const prompt = `REFERENCE DOCUMENTS (complete):\n${DOC}\n\n${copilotConversation({ meeting: c.meeting, brief: '', transcript: c.transcript, trigger: 'button', ask: 'The most recent question addressed to Rick in the transcript.' })}`
    const t0 = Date.now()
    const r = await ai.models.generateContent({ model: GEMINI_MODELS.copilot, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { systemInstruction: COPILOT_SYSTEM, temperature: 0.3, maxOutputTokens: 500, thinkingConfig: NO_THINKING } })
    const txt = (r.text ?? '').replace(/\s+/g, ' ').trim()
    check(c.si.test(txt) && !c.no.test(txt), `${c.n} · ${Date.now() - t0} ms · «${txt.slice(0, 170)}»`)
  }
}

sinRed()
if (process.argv.includes('--real')) await real()
console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodas las pruebas pasaron')
process.exit(failures ? 1 : 0)
