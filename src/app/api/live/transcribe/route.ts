import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { transcribeAudio } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  audio_base64: z.string().min(10),
  mime_type:    z.string().default('audio/webm'),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const text = await transcribeAudio(parsed.data.audio_base64, parsed.data.mime_type)

  const SILENCE = ['[SILENCIO]', '[SILENCE]', '[NO SPEECH]', '[NO AUDIO]', '[INAUDIBLE]']
  if (!text || text.length < 2 || SILENCE.some(p => text.toUpperCase().includes(p))) {
    return NextResponse.json({ text: '' })
  }

  return NextResponse.json({ text })
}
