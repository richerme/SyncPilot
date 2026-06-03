import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { transcribe } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  audio_base64: z.string().min(10),
  mime_type:    z.string().default('audio/webm'),
})

const SILENCE = ['[SILENCIO]', '[SILENCE]', '[NO SPEECH]', '[NO AUDIO]', '[INAUDIBLE]', '(silencio)', '(silence)']

function isSilence(text: string): boolean {
  return !text || text.length < 2 || SILENCE.some(p => text.toUpperCase().includes(p.toUpperCase()))
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const { audio_base64, mime_type } = parsed.data

  // Gemini primario, Whisper de respaldo (ver lib/openrouter#transcribe).
  const text = await transcribe(audio_base64, mime_type)

  if (isSilence(text)) return NextResponse.json({ text: '' })

  return NextResponse.json({ text })
}
