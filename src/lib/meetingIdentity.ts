// Qué reunión es esta (título, fecha y hora de inicio) para que el Copiloto elija la entrada correcta
// cuando un documento trae el estatus de varios clientes o reuniones (pedido del usuario, 10 nov 2026):
// primero la que coincide en cliente, fecha y hora; si no, por el cliente del título o lo que se dice.
// Sin imports de servidor (prisma) para poder probarlo con scripts/test-meeting-identity.ts.
import { COPILOT_NAME } from '../features/live/copilot/profile'

export interface MeetingIdentity { title: string | null; startedAt: Date }

/** Zona horaria en la que el usuario escribe la fecha y la hora de sus reuniones. */
export const MEETING_TIME_ZONE = process.env.SYNCPILOT_TIME_ZONE || 'America/Mexico_City'

// El título que pone la app cuando no escribes uno («Reunión 10/11/2026»): no trae al cliente.
const AUTO_TITLE = /^Reunión \d{1,2}\/\d{1,2}\/\d{2,4}$/

export function meaningfulTitle(title: string | null | undefined): string | null {
  const t = title?.trim()
  return t && !AUTO_TITLE.test(t) ? t : null
}

function fmt(d: Date, locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...opts }).format(d)
}

/** Bloque para el prompt del Copiloto (en inglés, como el resto de sus instrucciones). */
export function describeMeeting(m: MeetingIdentity, timeZone = MEETING_TIME_ZONE): string {
  const long: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
  const ymd = fmt(m.startedAt, 'en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }) // 2026-11-10
  const [y, mo, d] = ymd.split('-')
  const time = fmt(m.startedAt, 'en-GB', timeZone, { hour: '2-digit', minute: '2-digit', hour12: false })
  const title = meaningfulTitle(m.title)
  return [
    'THIS MEETING (use it to pick the right entry when a document covers several clients or meetings):',
    title ? `- Title: "${title}"` : '- Title: none with the client name (identify the client from the transcript)',
    `- Date: ${fmt(m.startedAt, 'en-US', timeZone, long)} (${fmt(m.startedAt, 'es-MX', timeZone, long)}; ${ymd}; ${d}/${mo}/${y})`,
    `- Started at: ${time} (${timeZone} time)`,
  ].join('\n')
}

/** La parte del prompt del Copiloto que cambia en cada pregunta (lo fijo va en el caché). */
/** Respuesta que el Copiloto ya le mostró al usuario en esta reunión (minuto desde el inicio). */
export interface EarlierAnswer { atMs: number; text: string }

const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

// Botón «Responder» sin pregunta (pedido del usuario, 19 nov 2026): tras contestar cuando lo nombran, la
// plática sigue (otro tema, una interrupción o el mismo tema alargado). El botón contesta lo de AHORA y no
// repite la respuesta anterior si ya no aplica.
export const BUTTON_ASK = `What ${COPILOT_NAME} should say NOW about the latest part of the transcript: the most recent question, request or open point directed at him or waiting for his input. Compare it with YOUR EARLIER ANSWERS: if the conversation moved to another topic after the last one, answer the newest point; if they extended or changed the same topic, give an updated answer that covers what was added; never repeat an earlier answer as it was. If nobody is waiting for him, give the most useful thing he could add to what is being discussed right now.`

export function copilotConversation(o: {
  meeting: MeetingIdentity; brief: string; transcript: string; trigger: 'button' | 'name' | 'typed'; ask: string
  earlier?: EarlierAnswer[]
}): string {
  const earlier = (o.earlier ?? []).filter(a => a.text.trim())
  return [
    describeMeeting(o.meeting),
    o.brief ? `MEETING CONTEXT (prepared at the start from the documents, in Spanish; if it points to another client or meeting than THIS MEETING, follow THIS MEETING):\n${o.brief}` : '',
    `MEETING TRANSCRIPT (whole meeting so far, oldest first, [mm:ss] from the start; "${COPILOT_NAME}:" is ${COPILOT_NAME}, "Meeting:" are the other participants):\n${o.transcript || '(empty)'}`,
    earlier.length
      ? `YOUR EARLIER ANSWERS IN THIS MEETING (already shown to ${COPILOT_NAME}, oldest first, [mm:ss] when shown):\n${earlier.map(a => `[${mmss(a.atMs)}] ${a.text.trim()}`).join('\n\n')}`
      : '',
    `${o.trigger === 'typed' ? `${COPILOT_NAME} wants help with` : 'QUESTION TO ANSWER'}: ${o.ask}`,
  ].filter(Boolean).join('\n\n')
}
