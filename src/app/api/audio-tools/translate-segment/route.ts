import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { chatCompletion, getGenAI } from '@/lib/openrouter'
import { GEMINI_MODELS } from '@/lib/geminiModels'
import { z } from 'zod'

const Schema = z.object({
  text:        z.string().min(1).max(2000),
  target_lang: z.string().default('es'),
})

const LANG_NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', fr: 'French', pt: 'Portuguese',
  de: 'German',  ja: 'Japanese', zh: 'Chinese', it: 'Italian', ko: 'Korean',
}

const instructions = (target: string) =>
  `You are a live meeting interpreter. Translate the user's text into ${target}. Output ONLY the translation, with no quotes or notes. `
  + 'Keep SAP terms, transaction codes, object and table names, and product names exactly as written. '
  + `If the text is already in ${target}, return it unchanged. The text may be an unfinished sentence: translate it as is.`

// Traducción en vivo: Gemini Flash-Lite directo (~0.6 s, lo más rápido medido);
// OpenRouter queda de respaldo si no hay llave de Gemini o falla.
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const { text, target_lang } = parsed.data
  const targetName = LANG_NAMES[target_lang] ?? 'Spanish'

  const ai = getGenAI()
  if (ai) {
    try {
      const result = await ai.models.generateContent({
        model: GEMINI_MODELS.translate,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: { systemInstruction: instructions(targetName), temperature: 0.1, maxOutputTokens: 512 },
      })
      const translated = (result.text ?? '').trim()
      if (translated) return NextResponse.json({ translated })
    } catch (err) {
      console.warn('[translate-segment] Gemini falló, usando OpenRouter:', err instanceof Error ? err.message : err)
    }
  }

  const translated = await chatCompletion([
    { role: 'system', content: instructions(targetName) },
    { role: 'user', content: text },
  ], { temperature: 0.1, maxTokens: 512 })

  return NextResponse.json({ translated: translated.trim() })
}
