'use client'

import { every } from '../utils/ticker'
import type { EngineStats } from '../engines/types'

// Diagnóstico de rendimiento de IA en Vivo (PRP-005, fase 3), pedido el 19 nov: «a los pocos minutos
// de compartir pantalla se comienza a trabar». Cada minuto guarda con la reunión lo necesario para
// saber la causa sin adivinar:
// - visible: si la pestaña estaba a la vista o tapada (Chrome frena las pestañas tapadas);
// - lagMs / longTasks: cuánto se atrasó la página (procesador ocupado) y cuántas tareas de más de 50 ms;
// - heapMb / domNodes: memoria de la página y tamaño de la pantalla;
// - buffered: audio que no logra salir hacia Soniox (subida saturada);
// - recBacklogMb: video de la Grabación que falta por subir (subida saturada).
// Al empezar se anota una vez el equipo: núcleos, memoria aproximada y qué se compartió (pestaña, ventana o pantalla).

const SAMPLE_MS = 60_000
const BEAT_MS = 250

export interface PerfMonitorDeps {
  send: (event: string, data: Record<string, string | number | boolean | null>) => void
  engineStats: () => EngineStats | undefined
  recordingBacklogBytes: () => number | null
  displaySurface: () => string | null
}

type LongTaskObserver = { disconnect(): void } | null

function heapMb(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
}

function observeLongTasks(onTask: (ms: number) => void): LongTaskObserver {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return null
  const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) onTask(e.duration) })
  obs.observe({ type: 'longtask', buffered: false })
  return obs
}

/** Arranca el monitor; devuelve la función que lo detiene. */
export function startPerfMonitor(deps: PerfMonitorDeps): () => void {
  const nav = navigator as Navigator & { deviceMemory?: number }
  deps.send('device', {
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null, // Chrome la redondea (máx. 8)
    surface: deps.displaySurface(),     // browser = pestaña · window = ventana · monitor = pantalla completa
  })

  let longTasks = 0, longMs = 0, maxLag = 0, hiddenMs = 0
  let lastBeat = Date.now()
  let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null

  const obs = observeLongTasks(ms => { longTasks++; longMs += ms })

  // Latido desde el Worker: si la página tarda en atenderlo, el procesador estaba ocupado.
  const stopBeat = every(BEAT_MS, () => {
    const now = Date.now()
    maxLag = Math.max(maxLag, now - lastBeat - BEAT_MS)
    lastBeat = now
  })

  const onVisibility = () => {
    const hidden = document.visibilityState === 'hidden'
    if (hidden && hiddenSince === null) hiddenSince = Date.now()
    if (!hidden && hiddenSince !== null) { hiddenMs += Date.now() - hiddenSince; hiddenSince = null }
    deps.send('visibility', { visible: !hidden })
  }
  document.addEventListener('visibilitychange', onVisibility)

  const stopSample = every(SAMPLE_MS, () => {
    const now = Date.now()
    if (hiddenSince !== null) { hiddenMs += now - hiddenSince; hiddenSince = now }
    const stats = deps.engineStats()
    const backlog = deps.recordingBacklogBytes()
    deps.send('perf', {
      visible: document.visibilityState !== 'hidden',
      hiddenS: Math.round(hiddenMs / 1000),
      lagMs: Math.max(0, Math.round(maxLag)),
      longTasks,
      longMs: Math.round(longMs),
      heapMb: heapMb(),
      domNodes: document.getElementsByTagName('*').length,
      buffered: stats?.buffered ?? null,
      queued: stats?.queued ?? null,
      recBacklogMb: backlog === null ? null : Math.round(backlog / 104857.6) / 10,
    })
    longTasks = 0; longMs = 0; maxLag = 0; hiddenMs = 0
  })

  return () => {
    stopBeat()
    stopSample()
    obs?.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
