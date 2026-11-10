// Respuesta del Copiloto con respaldo (10 nov 2026).
//
// Por qué: el 9 y el 10 de noviembre el Copiloto contestó «No se pudo generar la respuesta» en dos
// reuniones. Gemini respondía 402 «Your prepayment credits are depleted» (saldo prepagado agotado) y la
// ruta no tenía a dónde ir. La transcripción y la traducción siguieron funcionando porque van por Soniox.
//
// Ahora la ruta abre el primer proveedor que de verdad entregue texto (Gemini y, si falla, OpenRouter)
// ANTES de responder al navegador: así un error sigue siendo un HTTP de error con un mensaje claro, y no
// un 200 vacío. Este módulo no depende de Next ni de la BD, para poder probarlo solo
// (scripts/test-copilot-fallback.ts).

export type AiFailureKind = 'sin_saldo' | 'cupo' | 'llave' | 'modelo' | 'red' | 'otro'

export interface ProviderFailure { provider: string; kind: AiFailureKind; detail: string }

export interface CopilotProvider {
  name: string
  /** Abre el stream de texto. Puede lanzar al abrir o al leer el primer pedazo. */
  open: () => Promise<AsyncIterable<string>>
}

export interface OpenedStream {
  provider: string
  /** El primer pedazo de texto ya leído (puede ser '' si el proveedor terminó sin texto). */
  first: string
  rest: AsyncIterator<string>
  failures: ProviderFailure[]
}

export class CopilotUnavailableError extends Error {
  constructor(public failures: ProviderFailure[]) {
    super(friendlyCopilotError(failures))
    this.name = 'CopilotUnavailableError'
  }
}

/** Clasifica el error de un proveedor de IA sin depender del SDK (status, code o texto del mensaje). */
export function classifyAiError(err: unknown): AiFailureKind {
  const e = err as { status?: number; code?: number | string; message?: string } | null
  const status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined
  const msg = `${e?.message ?? String(err ?? '')}`.toLowerCase()
  if (status === 402 || /prepayment|credits are depleted|insufficient (credits|balance)|payment required|billing/.test(msg)) return 'sin_saldo'
  if (status === 429 || /quota|rate limit|resource_exhausted|too many requests/.test(msg)) return 'cupo'
  if (status === 401 || status === 403 || /api key|permission denied|unauthorized|unauthenticated/.test(msg)) return 'llave'
  if (status === 404 || /not found|is not supported|unknown model|no endpoints/.test(msg)) return 'modelo'
  if (/fetch failed|econnreset|etimedout|enotfound|network|socket/.test(msg)) return 'red'
  return 'otro'
}

const KIND_TEXT: Record<AiFailureKind, string> = {
  sin_saldo: 'la cuenta de IA se quedó sin saldo',
  cupo: 'se alcanzó el límite de uso de la IA',
  llave: 'la llave de la IA no es válida',
  modelo: 'el modelo de IA no está disponible',
  red: 'no hubo conexión con la IA',
  otro: 'la IA devolvió un error',
}

/** Mensaje para el usuario (sin datos sensibles): qué pasó con cada proveedor y qué hacer. */
export function friendlyCopilotError(failures: ProviderFailure[]): string {
  if (!failures.length) return 'No hay ningún proveedor de IA configurado.'
  const parts = failures.map(f => `${f.provider}: ${KIND_TEXT[f.kind]}`)
  const fix = failures.some(f => f.kind === 'sin_saldo') ? ' Recarga el saldo del proveedor y vuelve a intentar.' : ' Vuelve a intentar en unos segundos.'
  return `${parts.join('; ')}.${fix}`
}

/** Prueba los proveedores en orden y devuelve el primero que entrega su primer pedazo sin error. */
export async function openWithFallback(providers: CopilotProvider[]): Promise<OpenedStream> {
  const failures: ProviderFailure[] = []
  for (const p of providers) {
    try {
      const it = (await p.open())[Symbol.asyncIterator]()
      // Lee hasta el primer pedazo con texto (algunos proveedores mandan pedazos vacíos al inicio).
      let first = ''
      for (;;) {
        const r = await it.next()
        if (r.done) break
        if (r.value) { first = r.value; break }
      }
      return { provider: p.name, first, rest: it, failures }
    } catch (err) {
      failures.push({ provider: p.name, kind: classifyAiError(err), detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) })
    }
  }
  throw new CopilotUnavailableError(failures)
}

/**
 * Texto en streaming de una API compatible con OpenAI (OpenRouter). Lanza un Error con `status`
 * si la respuesta no es 2xx, para que classifyAiError lo entienda.
 */
export async function* chatCompletionStream(opts: {
  url: string; apiKey: string; model: string; system: string; user: string
  temperature?: number; maxTokens?: number; headers?: Record<string, string>; fetchImpl?: typeof fetch
}): AsyncGenerator<string> {
  const res = await (opts.fetchImpl ?? fetch)(opts.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', ...opts.headers },
    body: JSON.stringify({
      model: opts.model, stream: true, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens ?? 500,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    const err = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let parsed: { choices?: { delta?: { content?: string } }[]; error?: { message?: string; code?: number } }
      try { parsed = JSON.parse(data) } catch { continue }
      if (parsed.error) {
        const err = new Error(parsed.error.message ?? 'error del proveedor') as Error & { status?: number }
        if (typeof parsed.error.code === 'number') err.status = parsed.error.code
        throw err
      }
      const t = parsed.choices?.[0]?.delta?.content
      if (t) yield t
    }
  }
}
