'use client'

// Relojes que siguen a tiempo aunque la pestaña esté tapada (PRP-005, fase 3).
//
// Al compartir pantalla, SyncPilot suele quedar detrás de lo que presentas. Chrome frena los relojes
// de una pestaña oculta: 1 vez por segundo de inmediato y, después de 5 minutos oculta y en silencio,
// 1 vez por MINUTO («intensive throttling», Chrome 88+). Con eso el vigilante de la transcripción
// tardaba hasta un minuto en notar que Soniox se colgó. Los relojes de un Worker dedicado no entran en
// esa regla: el Worker late cada TICK_MS y avisa a la página con un mensaje, que no se frena.
// Si no hay Worker (pruebas en Node), se usa setInterval normal.

const TICK_MS = 250
const WORKER_SOURCE = `setInterval(() => postMessage(0), ${TICK_MS})`

interface Sub { every: number; last: number; fn: () => void }

const subs = new Set<Sub>()
let worker: Worker | null = null

function beat() {
  const now = Date.now()
  for (const s of subs) {
    if (now - s.last < s.every) continue
    s.last = now
    try { s.fn() } catch (err) { console.error('[ticker]', err) }
  }
}

function startWorker(): boolean {
  if (worker) return true
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return false
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = beat
    return true
  } catch {
    worker = null
    return false
  }
}

function stopWorkerIfIdle() {
  if (subs.size || !worker) return
  worker.terminate()
  worker = null
}

/** Llama `fn` cada `ms` (mínimo 250 ms) aunque la pestaña esté oculta. Devuelve la función para pararlo. */
export function every(ms: number, fn: () => void): () => void {
  if (!startWorker()) {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  }
  const sub: Sub = { every: Math.max(ms, TICK_MS), last: Date.now(), fn }
  subs.add(sub)
  return () => { subs.delete(sub); stopWorkerIfIdle() }
}

/** Llama `fn` una vez dentro de `ms`, también con la pestaña oculta. Devuelve la función para cancelarlo. */
export function after(ms: number, fn: () => void): () => void {
  let stop: () => void = () => {}
  stop = every(ms, () => { stop(); fn() })
  return stop
}
