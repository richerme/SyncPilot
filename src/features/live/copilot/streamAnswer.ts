'use client'

export type CopilotTrigger = 'button' | 'name' | 'typed'
/** `context` = «Investigar» libre (PRP-005): tarjeta con lo que se está hablando, sin pregunta. */
export type CardTrigger = CopilotTrigger | 'context'
export type CopilotLang = 'en' | 'es'

export interface ResearchSource { title: string; domain: string; url: string }

/** «Verificado en internet» (PRP-004): lo que devolvió «Investigar» para una respuesta. */
export interface CopilotResearch {
  status: 'loading' | 'done' | 'error'
  query?: string            // la pregunta que salió a internet (sin datos del proyecto)
  text?: string             // resultado tal cual lo devuelve la búsqueda (no se modifica)
  sources?: ResearchSource[]
  searchQueries?: string[]  // lo que buscó Google
  suggestionsHtml?: string  // «Search Suggestions» de Google (obligatorio mostrarlas con el resultado)
  error?: string
  ms?: number
}

export interface CopilotAnswer {
  id: string
  trigger: CardTrigger
  question: string | null
  text: string
  status: 'streaming' | 'done' | 'error'
  research?: CopilotResearch
  /** Solo en `context`: los últimos puntos de la reunión, en el idioma que se habla. */
  points?: string[]
}

/** Error del Copiloto. `forUser` = el mensaje viene del servidor y se puede mostrar en pantalla. */
export class CopilotError extends Error {
  constructor(message: string, public forUser: boolean) { super(message); this.name = 'CopilotError' }
}

/** Texto que se muestra en la tarjeta del Copiloto cuando no hubo respuesta. */
export function copilotErrorText(err: unknown): string {
  const base = 'No se pudo generar la respuesta.'
  return err instanceof CopilotError && err.forUser ? `${base} ${err.message}` : `${base} Intenta de nuevo.`
}

async function postResearch<T>(meetingId: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/meetings/${meetingId}/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new CopilotError(data.error ?? `HTTP ${res.status}`, !!data.error)
  return data
}

type ResearchResult = Omit<CopilotResearch, 'status' | 'error'>

/** «Investigar» de una respuesta: el servidor reescribe la pregunta sin datos del proyecto y busca en internet. */
export function researchAnswer(meetingId: string, body: { question?: string; answer: string; live: string }): Promise<ResearchResult> {
  return postResearch(meetingId, { mode: 'answer', ...body })
}

/** «Investigar» libre, parte 1: últimos puntos (idioma de la reunión) y la pregunta técnica ya filtrada. */
export function researchContext(meetingId: string, live: string): Promise<{ language: string; points: string[]; query: string }> {
  return postResearch(meetingId, { mode: 'context', live })
}

/** «Investigar» libre, parte 2: busca esa pregunta y contesta en el idioma de la reunión. */
export function researchQuery(meetingId: string, query: string, language: string): Promise<ResearchResult> {
  return postResearch(meetingId, { mode: 'search', query, language })
}

/** Pide la respuesta al servidor y la va entregando conforme llega (streaming). */
export async function streamAnswer(
  meetingId: string,
  body: { question?: string; live: string; trigger: CopilotTrigger; answerLang: CopilotLang },
  onText: (text: string) => void,
): Promise<string> {
  const res = await fetch(`/api/meetings/${meetingId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    // El servidor manda un mensaje pensado para el usuario (sin datos sensibles): se muestra tal cual.
    throw new CopilotError(data.error ?? `HTTP ${res.status}`, !!data.error)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
  return text.trim()
}
