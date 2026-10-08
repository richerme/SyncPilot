import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { transcribe } from '@/lib/openrouter'
import { z } from 'zod'

const Schema = z.object({
  audio_base64: z.string().min(10),
  mime_type:    z.string().default('audio/webm'),
})

// IA en Vivo manda tramos de 0.8-3.5 s en WAV 16 kHz (~32 KB por segundo).
const MAX_AUDIO_BYTES = 2 * 1024 * 1024

const SILENCE = ['[SILENCIO]', '[SILENCE]', '[NO SPEECH]', '[NO AUDIO]', '[INAUDIBLE]', '(silencio)', '(silence)']

function isSilence(text: string): boolean {
  return !text || text.length < 2 || SILENCE.some(p => text.toUpperCase().includes(p.toUpperCase()))
}

// Cuerpo binario (audio/wav, el que usa IA en Vivo: sin base64 en el navegador)
// o JSON { audio_base64, mime_type } (formato anterior).
async function readAudio(request: Request): Promise<{ base64: string; mime: string } | string> {
  const type = request.headers.get('content-type') ?? ''
  if (type.startsWith('audio/')) {
    const buf = Buffer.from(await request.arrayBuffer())
    if (buf.length < 200) return 'Audio vacío'
    if (buf.length > MAX_AUDIO_BYTES) return 'Audio demasiado largo'
    return { base64: buf.toString('base64'), mime: type.split(';')[0] }
  }
  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return 'Datos inválidos'
  return { base64: parsed.data.audio_base64, mime: parsed.data.mime_type }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const audio = await readAudio(request)
  if (typeof audio === 'string') return NextResponse.json({ error: audio }, { status: 400 })

  // Gemini primario, Whisper de respaldo (ver lib/openrouter#transcribe).
  const text = await transcribe(audio.base64, audio.mime)

  if (isSilence(text)) return NextResponse.json({ text: '' })

  return NextResponse.json({ text })
}
