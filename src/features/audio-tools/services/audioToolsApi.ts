import type { AccentAnalysis, MeetingAnalysis, SupportedLanguage, TranslationResult } from '../types'

export async function translateAudio(
  audioBase64: string,
  mimeType: string,
  targetLang: SupportedLanguage,
  withTTS = false,
): Promise<TranslationResult> {
  const res = await fetch('/api/audio-tools/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType, target_lang: targetLang, with_tts: withTTS }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Error al traducir') }
  return res.json()
}

export async function translateSegment(text: string, targetLang: SupportedLanguage): Promise<string> {
  const res = await fetch('/api/audio-tools/translate-segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target_lang: targetLang }),
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data.translated ?? ''
}

export async function detectLanguage(audioBase64: string, mimeType: string): Promise<AccentAnalysis> {
  const res = await fetch('/api/audio-tools/detect-language', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Error al analizar') }
  return res.json()
}

export async function analyzeMeeting(meetingId: string): Promise<MeetingAnalysis> {
  const res = await fetch('/api/audio-tools/meeting-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meeting_id: meetingId }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? 'Error al analizar reunión') }
  return res.json()
}

export async function getSavedMeetingAnalysis(meetingId: string): Promise<MeetingAnalysis | null> {
  const res = await fetch(`/api/audio-tools/meeting-analysis?meetingId=${meetingId}`)
  if (!res.ok) return null
  return res.json()
}
