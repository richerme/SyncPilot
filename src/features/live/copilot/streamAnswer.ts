'use client'

export type CopilotTrigger = 'button' | 'name' | 'typed'

export interface CopilotAnswer {
  id: string
  trigger: CopilotTrigger
  question: string | null
  text: string
  status: 'streaming' | 'done' | 'error'
}

/** Pide la respuesta al servidor y la va entregando conforme llega (streaming). */
export async function streamAnswer(
  meetingId: string,
  body: { question?: string; transcript: string; trigger: CopilotTrigger },
  onText: (text: string) => void,
): Promise<string> {
  const res = await fetch(`/api/meetings/${meetingId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? `HTTP ${res.status}`)
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
