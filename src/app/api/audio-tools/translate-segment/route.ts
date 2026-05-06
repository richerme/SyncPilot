import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { chatCompletion } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  text:        z.string().min(1).max(2000),
  target_lang: z.string().default('es'),
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

  const { text, target_lang } = parsed.data
  const targetName = LANG_NAMES[target_lang] ?? 'Spanish'

  const translated = await chatCompletion([{
    role: 'user',
    content: `Translate to ${targetName}. Return ONLY the translation, nothing else: "${text}"`,
  }], { temperature: 0.2, maxTokens: 512 })

  return NextResponse.json({ translated: translated.trim() })
}
