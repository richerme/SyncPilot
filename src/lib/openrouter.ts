import OpenAI, { toFile } from 'openai'
import { GoogleGenAI } from '@google/genai'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash-lite'

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

// Transcripción con Gemini (gemini-2.5-flash). Decodifica de forma robusta los
// chunks WebM/Opus cortos que produce MediaRecorder desde un stream mezclado
// (mic + pestaña/sistema), donde Whisper suele devolver vacío. Es el backend
// primario para "IA en Vivo".
let genaiClient: GoogleGenAI | null = null
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return genaiClient
}

// Lanza si Gemini no está disponible o la API falla, para que la ruta pueda
// caer a Whisper SOLO ante un error real (no ante silencio legítimo, que se
// devuelve como '[SILENCIO]'/'' sin gastar llamadas a OpenAI).
export async function transcribeAudioGemini(audioBase64: string, mimeType: string): Promise<string> {
  const ai = getGenAI()
  if (!ai) throw new Error('GEMINI_API_KEY no configurada')

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mimeType.split(';')[0], data: audioBase64 } },
        {
          text: `Transcribe exactly as spoken. Rules:
- ONLY output the spoken text, nothing else
- Keep original language (Spanish/English/mixed)
- If silence or noise only, return: [SILENCIO]
- If multiple speakers, separate with line breaks`,
        },
      ],
    }],
    config: { temperature: 0.05, maxOutputTokens: 256 },
  })
  return (result.text ?? '').trim()
}

// Extrae texto de un documento (PDF) usando Gemini, que acepta PDF como
// inlineData nativamente. Se usa al subir documentos de contexto para que
// la reunión pueda apoyarse en su contenido.
export async function extractTextFromPdf(base64: string): Promise<string> {
  const ai = getGenAI()
  if (!ai) {
    console.error('[extractTextFromPdf] GEMINI_API_KEY no configurada')
    return ''
  }
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: base64 } },
          { text: 'Extrae TODO el texto de este documento tal cual, sin resumir ni añadir comentarios. Conserva el orden y los saltos de párrafo.' },
        ],
      }],
      config: { temperature: 0, maxOutputTokens: 8192 },
    })
    return (result.text ?? '').trim()
  } catch (err) {
    console.error('[extractTextFromPdf] error:', err instanceof Error ? err.message : err)
    return ''
  }
}

// Transcripción unificada: Gemini primario, Whisper como respaldo SOLO si
// Gemini lanza error o no está configurado. Úsala en todas las features de voz.
export async function transcribe(audioBase64: string, mimeType: string): Promise<string> {
  try {
    return await transcribeAudioGemini(audioBase64, mimeType)
  } catch (err) {
    console.warn('[transcribe] Gemini falló, usando Whisper:', err instanceof Error ? err.message : err)
    return await transcribeAudio(audioBase64, mimeType)
  }
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
