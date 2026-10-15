import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

// Llave temporal de Soniox para que el navegador mande el audio de la reunión directo por
// WebSocket (PRP-003 fase 2). La llave real (SONIOX_API_KEY) nunca sale del servidor; la
// temporal solo sirve para abrir una conexión en los próximos 2 minutos.
const Schema = z.object({ meetingId: z.string().min(1).max(40) })
const TEMP_KEY_URL = 'https://api.soniox.com/v1/auth/temporary-api-key'
const SONIOX_MODEL = 'stt-rt-v5'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const parsed = Schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const { meetingId } = parsed.data
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, userId: session.user.id }, select: { id: true } })
  if (!meeting) return NextResponse.json({ error: 'Reunión no encontrada' }, { status: 404 })

  // Sin llave: IA en Vivo usa la transcripción por tramos (Gemini).
  const key = process.env.SONIOX_API_KEY
  if (!key) return NextResponse.json({ error: 'Transcripción en streaming no configurada' }, { status: 404 })

  try {
    const res = await fetch(TEMP_KEY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 120, client_reference_id: meetingId }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json().catch(() => ({})) as { api_key?: string; error_message?: string }
    if (!res.ok || !data.api_key) {
      console.warn('[stt-token] Soniox', res.status, data.error_message?.slice(0, 160))
      return NextResponse.json({ error: 'No se pudo abrir la transcripción en streaming' }, { status: 502 })
    }
    return NextResponse.json({ apiKey: data.api_key, model: SONIOX_MODEL })
  } catch (err) {
    console.warn('[stt-token]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'No se pudo abrir la transcripción en streaming' }, { status: 502 })
  }
}
