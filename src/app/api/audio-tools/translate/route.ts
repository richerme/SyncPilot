import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { transcribeAudio, chatCompletion } from '@/lib/openrouter'
import { synthesizeSpeech } from '@/lib/tts'
import { z } from 'zod'

export const maxDuration = 120

const Schema = z.object({
  audio_base64: z.string().min(10),
  mime_type:    z.string().default('audio/webm'),
  target_lang:  z.string().default('es'),
  with_tts:     z.boolean().default(false),
})

const LANG_NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', fr: 'French', pt: 'Portuguese',
  de: 'German',  ja: 'Japanese', zh: 'Chinese', it: 'Italian', ko: 'Korean',
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const { audio_base64, mime_type, target_lang, with_tts } = parsed.data

  try {
    // 1. Transcribir audio
    const originalText = await transcribeAudio(audio_base64, mime_type)
    if (!originalText || originalText.length < 2) {
      return NextResponse.json({ error: 'No se detectó habla en el audio' }, { status: 422 })
    }

    // 2. Detectar idioma del texto original
    const detectedLangRaw = await chatCompletion([{
      role: 'user',
      content: `Identify the language of this text. Respond with ONLY the ISO 639-1 code (e.g., "es", "en", "fr"). Text: "${originalText.slice(0, 200)}"`,
    }], { temperature: 0, maxTokens: 5 })
    const detectedLang = detectedLangRaw.trim().toLowerCase().slice(0, 2)

    // 3. Traducir
    const targetLangName = LANG_NAMES[target_lang] ?? 'Spanish'
    const translatedText = await chatCompletion([{
      role: 'user',
      content: `Translate the following text to ${targetLangName}. Return ONLY the translated text, nothing else.\n\nText: ${originalText}`,
    }], { temperature: 0.3, maxTokens: 2048 })

    // 4. Síntesis de voz (opcional)
    let audioBase64Out: string | undefined
    if (with_tts && translatedText.length > 0) {
      const audioBuffer = await synthesizeSpeech(translatedText.slice(0, 4096))
      audioBase64Out = audioBuffer.toString('base64')
    }

    return NextResponse.json({
      originalText,
      translatedText: translatedText.trim(),
      detectedLang,
      targetLang: target_lang,
      audioBase64: audioBase64Out,
    })
  } catch (err) {
    console.error('[audio-tools/translate]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al procesar' }, { status: 500 })
  }
}
