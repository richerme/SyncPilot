import OpenAI, { toFile } from 'openai'

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

// Transcripción real de audio usando OpenAI Whisper.
// Whisper acepta nativamente webm/opus, mp3, wav, m4a, etc. y maneja español/inglés.
let openaiClient: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('[transcribeAudio] OPENAI_API_KEY no configurada')
    return ''
  }

  const buffer = Buffer.from(audioBase64, 'base64')
  const cleanMime = mimeType.split(';')[0] || 'audio/webm'
  const ext = cleanMime.split('/')[1] || 'webm'

  try {
    const file = await toFile(buffer, `chunk.${ext}`, { type: cleanMime })

    const result = await getOpenAI().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      temperature: 0,
      response_format: 'text',
    })

    const text = typeof result === 'string' ? result : (result as { text?: string }).text ?? ''
    return text.trim()
  } catch (err) {
    console.error('[transcribeAudio] Whisper error:', err instanceof Error ? err.message : err)
    return ''
  }
}
