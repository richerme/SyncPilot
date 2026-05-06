const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash-lite-preview-06-17'

interface TextMessage {
  type: 'text'
  text: string
}

interface AudioMessage {
  type: 'image_url'
  image_url: { url: string }
}

type ContentPart = TextMessage | AudioMessage

export async function chatCompletion(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | ContentPart[] }>,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
      'X-Title':       'SyncPilot',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature:  opts.temperature  ?? 0.2,
      max_tokens:   opts.maxTokens    ?? 2048,
      response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const text = await chatCompletion([
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType.split(';')[0]};base64,${audioBase64}` },
        },
        {
          type: 'text',
          text: 'Transcribe exactly as spoken. ONLY output the spoken text, nothing else. Keep original language (Spanish/English/mixed). If silence or noise only, return: [SILENCIO].',
        },
      ],
    },
  ], { temperature: 0.05, maxTokens: 512 })

  return text.trim()
}
