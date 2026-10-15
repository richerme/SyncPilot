// Motores de transcripción de la reunión. Los dos entregan lo mismo a IA en Vivo:
// - chunked: tramos cortados en pausas → /api/live/transcribe (Gemini). Respaldo, sin cuenta extra.
// - stream:  audio continuo por WebSocket (Soniox): palabras conforme se dicen y traducción a la par.

export type EngineKind = 'chunked' | 'stream'

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
  /** Terminó de hablar quien tenía la palabra. */
  turnEnd(): void
  /** Texto recién reconocido, para detectar el nombre lo antes posible. */
  heard(text: string): void
  log(msg: string): void
}

export interface MeetingEngine {
  readonly kind: EngineKind
  /** Manda lo pendiente, espera las últimas respuestas y cierra. */
  stop(): Promise<void>
}
