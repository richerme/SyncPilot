'use client'

// Canal entre pestañas del mismo navegador: IA en Vivo publica lo que se transcribe y
// el Live Translator (Voice AI Tools) lo recibe al instante, sin pasar por el servidor.

export const LIVE_CHANNEL = 'syncpilot-live'

export type LiveSpeaker = 'me' | 'meeting'

export interface LiveSegmentMessage { id: string; text: string; speaker: LiveSpeaker; startMs: number }

export type LiveMessage =
  | { type: 'status'; active: boolean }
  | ({ type: 'segment' } & LiveSegmentMessage)
  | { type: 'interim'; speaker: LiveSpeaker; text: string }
  | { type: 'hello' } // el traductor acaba de abrir y pide lo que va de la sesión
  | { type: 'snapshot'; active: boolean; segments: LiveSegmentMessage[] }

export function openLiveChannel(onMessage?: (msg: LiveMessage) => void): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(LIVE_CHANNEL)
  if (onMessage) channel.onmessage = (e: MessageEvent<LiveMessage>) => onMessage(e.data)
  return channel
}
