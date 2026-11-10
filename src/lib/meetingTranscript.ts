// La reunión completa para el Copiloto (PRP-003): lo guardado en la BD + lo que el navegador aún no
// guarda. La usan la respuesta (/answer) y «Investigar» (/research).
import { prisma } from '@/lib/db'
import { COPILOT_NAME } from '@/features/live/copilot/profile'

// 1-2 h de reunión son ~40k tokens; el tope solo protege de lo absurdo.
const MAX_TRANSCRIPT_CHARS = 400_000

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export async function fullTranscript(meetingId: string, live: string): Promise<string> {
  const rows = await prisma.transcript.findMany({
    where: { meetingId }, orderBy: { startMs: 'asc' }, select: { startMs: true, speaker: true, text: true },
  })
  const saved = rows.map(r => `[${mmss(r.startMs)}] ${r.speaker === 'me' ? COPILOT_NAME : 'Meeting'}: ${r.text}`).join('\n')
  return `${saved}\n${live}`.trim().slice(-MAX_TRANSCRIPT_CHARS)
}
