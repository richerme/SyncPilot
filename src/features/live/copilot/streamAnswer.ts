'use client'

export type CopilotTrigger = 'button' | 'name' | 'typed'

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
  trigger: CopilotTrigger
  question: string | null
  text: string
  status: 'streaming' | 'done' | 'error'
  research?: CopilotResearch
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

/** «Investigar»: el servidor reescribe la pregunta sin datos del proyecto y busca en internet. */
export async function researchAnswer(
  meetingId: string,
  body: { question?: string; answer: string; live: string },
): Promise<Omit<CopilotResearch, 'status' | 'error'>> {
  const res = await fetch(`/api/meetings/${meetingId}/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as Omit<CopilotResearch, 'status'>
  if (!res.ok) throw new CopilotError(data.error ?? `HTTP ${res.status}`, !!data.error)
  return data
}

/** Pide la respuesta al servidor y la va entregando conforme llega (streaming). */
export async function streamAnswer(
  meetingId: string,
  body: { question?: string; live: string; trigger: CopilotTrigger },
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
