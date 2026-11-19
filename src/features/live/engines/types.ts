// Motores de transcripción de la reunión. Los dos entregan lo mismo a IA en Vivo:
// - chunked: tramos cortados en pausas → /api/live/transcribe (Gemini). Respaldo, sin cuenta extra.
// - stream:  audio continuo por WebSocket (Soniox): palabras conforme se dicen y traducción a la par.

export type EngineKind = 'chunked' | 'stream'

/** Salud del motor, para avisar en pantalla en vez de quedarse congelado en silencio. */
export type EngineStatus = 'ok' | 'reconnecting' | 'no-audio'

export interface LivePreview {
  /** Lo ya reconocido del turno en curso que todavía no pasa al historial. */
  text: string
  /** Lo que aún puede cambiar (stream) o tramos en camino ("…" en chunked). */
  tentative: string
}

export interface EngineCallbacks {
  preview(p: LivePreview): void
  /** Traducción del turno en curso (solo stream; en chunked la hace useLiveTranslation). */
  translationPreview?(p: LivePreview): void
  /** Pedazo cerrado: va al historial y se guarda. `translation` solo en stream. */
  commit(text: string, translation?: string): void
  /** Traducción que llegó después de cerrar el pedazo: se agrega al último (solo stream). */
  amendTranslation?(text: string): void
  /** Terminó de hablar quien tenía la palabra. */
  turnEnd(): void
  /** Texto recién reconocido, para detectar el nombre lo antes posible. */
  heard(text: string): void
  log(msg: string): void
  /** Cambió la salud del motor (reconectando, sin audio, o de nuevo bien). */
  status?(s: EngineStatus): void
  /** Evento de diagnóstico que se guarda con la reunión (conexión, cortes, reconexiones). */
  diag?(event: string, data?: Record<string, unknown>): void
}

/** Números del motor para el diagnóstico de rendimiento (PRP-005, fase 3). */
export interface EngineStats {
  /** Bytes de audio que el navegador aún no logra mandar (la subida no alcanza). */
  buffered: number
  /** Tramos guardados mientras se abre la conexión. */
  queued: number
  reconnects: number
}

export interface MeetingEngine {
  readonly kind: EngineKind
  /** Manda lo pendiente, espera las últimas respuestas y cierra. */
  stop(): Promise<void>
  /** Cambia el idioma de la traducción sin cortar la reunión (solo stream: reabre la conexión). */
  setTranslateTo?(lang: string | null): void
  stats?(): EngineStats
}
