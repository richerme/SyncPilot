// Prueba del vigilante del motor en streaming (18 nov 2026: la transcripción se congelaba a media
// reunión). Lógica pura, sin red ni navegador:
//   node --import <register.mjs> --experimental-transform-types scripts/test-stream-watchdog.ts
import { StreamWatchdog, nextReconnect } from '../src/features/live/engines/streamEngine'

let fails = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` → ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`}`)
}

// Simula un reloj: tramos de audio cada 100 ms y mensajes de Soniox cada `msgEvery` ms (0 = nunca).
function run(ms: number, opts: { msgEvery?: number; audioUntil?: number; buffered?: number; open?: boolean } = {}) {
  const w = new StreamWatchdog(0)
  const verdicts = new Set<string>()
  let first: { verdict: string; at: number } | null = null
  for (let t = 0; t <= ms; t += 100) {
    if (opts.audioUntil === undefined || t <= opts.audioUntil) w.frame(t)
    if (opts.msgEvery && t % opts.msgEvery === 0) w.message(t)
    if (t % 1000 === 0) {
      const v = w.check(t, opts.open ?? true, opts.buffered ?? 0)
      verdicts.add(v)
      if (v !== 'ok' && !first) first = { verdict: v, at: t }
    }
  }
  return { verdicts: [...verdicts], first }
}

// 1. Conexión sana: Soniox responde cada ~1 s (aun en silencio) → nunca reconecta.
check('conexión sana 5 min: siempre ok', run(300_000, { msgEvery: 1000 }).verdicts, ['ok'])
// Huecos de hasta 1.2 s medidos con Soniox real → siguen siendo ok.
check('huecos de 1.2 s: ok', run(60_000, { msgEvery: 1200 }).verdicts, ['ok'])
// 2. Conexión colgada: deja de responder a los 30 s → se detecta a los ~41 s (10 s de margen).
{
  const w = new StreamWatchdog(0)
  let first: { verdict: string; at: number } | null = null
  for (let t = 0; t <= 60_000; t += 100) {
    w.frame(t)
    if (t <= 30_000 && t % 1000 === 0) w.message(t)
    if (t % 1000 === 0 && !first) { const v = w.check(t, true, 0); if (v !== 'ok') first = { verdict: v, at: t } }
  }
  check('colgada a los 30 s → stalled a los 41 s', first, { verdict: 'stalled', at: 41_000 })
}
// 3. Deja de llegar el audio (AudioContext suspendido): no-audio a los ~4 s, sin acusar a la conexión.
{
  const r = run(30_000, { msgEvery: 0, audioUntil: 5000 })
  check('sin audio desde los 5 s → no-audio', r.first, { verdict: 'no-audio', at: 9000 })
  check('sin audio no se confunde con conexión colgada', r.verdicts.includes('stalled'), false)
}
// 3b. El audio vuelve tras 20 s sin audio: no reconecta de inmediato (el reloj se reinició mientras no había audio).
{
  const w = new StreamWatchdog(0)
  const seen: string[] = []
  for (let t = 0; t <= 40_000; t += 100) {
    if (t < 5000 || t > 25_000) w.frame(t)
    if (t > 25_000 && t % 1000 === 0) w.message(t)
    if (t % 1000 === 0) seen.push(w.check(t, true, 0))
  }
  check('al volver el audio no hay falsa alarma', seen.slice(27).every(v => v === 'ok'), true)
}
// 4. El audio no sale del navegador (bufferedAmount crece).
check('1.2 MB en espera → backlog', run(2000, { msgEvery: 1000, buffered: 1_200_000 }).first, { verdict: 'backlog', at: 0 })
// 5. Mientras se reconecta (conexión cerrada) no se acusa nada.
check('conexión cerrada → ok', run(30_000, { msgEvery: 0, open: false }).verdicts, ['ok'])
// 6. Límite de reconexiones: 6 en 10 min; la 7.ª pasa al motor por tramos; después de 10 min se vuelve a permitir.
{
  let times: number[] = []
  for (let i = 0; i < 6; i++) times = nextReconnect(times, i * 1000) ?? times
  check('6 reconexiones permitidas', times.length, 6)
  check('la 7.ª en la misma ventana no', nextReconnect(times, 7000), null)
  check('a los 10 min y 1 s ya salieron las 2 primeras: se permite otra', (nextReconnect(times, 10 * 60_000 + 1000) ?? []).length, 5)
  check('pasados 10 min de la última, la ventana queda limpia', (nextReconnect(times, 10 * 60_000 + 6000) ?? []).length, 1)
}

console.log(fails ? `\n${fails} fallaron` : '\nTodas pasaron')
process.exit(fails ? 1 : 0)
