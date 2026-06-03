import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { synthesizeSpeech } from '@/lib/tts'
import { z } from 'zod'
import type { TTSVoice } from '@/lib/tts'

const Schema = z.object({
  text:  z.string().min(1).max(4096),
  voice: z.enum(['nova','alloy','echo','fable','onyx','shimmer']).default('nova'),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })

  const audioBuffer = await synthesizeSpeech(parsed.data.text, parsed.data.voice as TTSVoice)

  return new NextResponse(audioBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type':        'audio/wav',
      'Content-Length':      String(audioBuffer.length),
      'Content-Disposition': 'inline; filename="speech.wav"',
    },
  })
}
