'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { openLiveChannel, type LiveMessage, type LiveSegmentMessage, type LiveSpeaker } from '@/features/live/broadcast'

export interface TranslatedSegment extends LiveSegmentMessage { translated: string | null }

const MAX_SEGMENTS = 300
const INTERIM_DEBOUNCE_MS = 250
const SNAPSHOT_TRANSLATE = 8 // al abrir a media sesión, solo se traducen los últimos

async function translate(text: string, lang: string): Promise<string | null> {
  try {
    const res = await fetch('/api/audio-tools/translate-segment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target_lang: lang }),
    })
    if (!res.ok) return null
    const data = await res.json() as { translated?: string }
    return data.translated?.trim() || null
  } catch {
    return null
  }
}

/**
 * Traducción en vivo de la sesión abierta en IA en Vivo (otra pestaña del mismo navegador).
 * Lo que dice la reunión se traduce mientras se habla (cada ~1-3 s llega texto nuevo del
 * turno y se re-traduce el turno completo, así la frase sale coherente); al cerrar el turno
 * se reutiliza esa traducción sin otra llamada.
 */
export function useLiveTranslation(lang: string) {
  const [active, setActive] = useState(false)
  const [segments, setSegments] = useState<TranslatedSegment[]>([])
  const [interim, setInterim] = useState<{ speaker: LiveSpeaker; text: string; translated: string | null } | null>(null)

  const segmentsRef = useRef<TranslatedSegment[]>([])
  useEffect(() => { segmentsRef.current = segments }, [segments])

  const langRef = useRef(lang)
  const cacheRef = useRef(new Map<string, string>()) // texto original → traducción (idioma actual)
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interimSeqRef = useRef(0)

  const translateSegment = useCallback(async (seg: LiveSegmentMessage) => {
    const cached = cacheRef.current.get(seg.text)
    const translated = cached ?? (seg.text.trim().split(/\s+/).length < 2 ? seg.text : await translate(seg.text, langRef.current))
    if (translated) {
      cacheRef.current.set(seg.text, translated)
      setSegments(prev => prev.map(s => (s.id === seg.id ? { ...s, translated } : s)))
    }
  }, [])

  const translateInterim = useCallback((speaker: LiveSpeaker, text: string) => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
    if (!text) { setInterim(null); return }
    setInterim(prev => ({ speaker, text, translated: prev?.speaker === speaker ? prev.translated : null }))
    if (speaker !== 'meeting') return // tu voz se traduce al cerrar la frase
    const seq = ++interimSeqRef.current
    interimTimerRef.current = setTimeout(async () => {
      const translated = await translate(text, langRef.current)
      if (!translated || seq !== interimSeqRef.current) return // ya llegó texto más nuevo
      cacheRef.current.set(text, translated)
      setInterim(prev => (prev && prev.text === text ? { ...prev, translated } : prev))
    }, INTERIM_DEBOUNCE_MS)
  }, [])

  const onMessage = useCallback((msg: LiveMessage) => {
    if (msg.type === 'status') {
      setActive(msg.active)
      if (!msg.active) setInterim(null)
    } else if (msg.type === 'snapshot') {
      setActive(msg.active)
      setSegments(msg.segments.map(s => ({ ...s, translated: null })))
      msg.segments.slice(-SNAPSHOT_TRANSLATE).forEach(s => { void translateSegment(s) })
    } else if (msg.type === 'segment') {
      const seg: TranslatedSegment = { id: msg.id, text: msg.text, speaker: msg.speaker, startMs: msg.startMs, translated: cacheRef.current.get(msg.text) ?? null }
      setActive(true)
      setSegments(prev => [...prev.slice(-(MAX_SEGMENTS - 1)), seg])
      if (msg.speaker === 'meeting') setInterim(null)
      if (!seg.translated) void translateSegment(msg)
    } else if (msg.type === 'interim') {
      translateInterim(msg.speaker, msg.text)
    }
  }, [translateInterim, translateSegment])

  useEffect(() => {
    const channel = openLiveChannel(onMessage)
    channel?.postMessage({ type: 'hello' } satisfies LiveMessage)
    return () => {
      channel?.close()
      if (interimTimerRef.current) clearTimeout(interimTimerRef.current)
    }
  }, [onMessage])

  // Cambio de idioma: se olvidan las traducciones y se re-traducen las últimas frases.
  useEffect(() => {
    if (langRef.current === lang) return
    langRef.current = lang
    cacheRef.current.clear()
    setInterim(null)
    const current = segmentsRef.current
    setSegments(current.map(s => ({ ...s, translated: null })))
    current.slice(-SNAPSHOT_TRANSLATE).forEach(s => { void translateSegment(s) })
  }, [lang, translateSegment])

  return { active, segments, interim, supported: typeof BroadcastChannel !== 'undefined' }
}
