'use client'

import { useEffect, useRef, useState } from 'react'
import type { TranscriptSegment } from './useLiveSession'

// Ajustes que se eligen en Voice AI Tools → Live Translator.
export const TRANSLATOR_ENABLED_KEY = 'syncpilot_live_translator_enabled'
export const TRANSLATOR_LANG_KEY    = 'syncpilot_live_translator_lang'

const INTERIM_DEBOUNCE_MS = 250
const CATCH_UP_SEGMENTS   = 8 // al activar o cambiar de idioma a media sesión, solo se traducen los últimos

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

/** Ajustes del traductor; se actualizan solos si se cambian en otra pestaña. */
export function useTranslatorSettings() {
  const [settings, setSettings] = useState({ enabled: false, lang: 'es' })
  useEffect(() => {
    const read = () => {
      try {
        setSettings({
          enabled: localStorage.getItem(TRANSLATOR_ENABLED_KEY) === 'true',
          lang: localStorage.getItem(TRANSLATOR_LANG_KEY) ?? 'es',
        })
      } catch { /* sin localStorage: queda apagado */ }
    }
    read()
    window.addEventListener('storage', read)
    return () => window.removeEventListener('storage', read)
  }, [])
  return settings
}

/**
 * Traducción en vivo de la transcripción. Lo que dice la reunión se traduce mientras se
 * habla (el turno completo se re-traduce con cada pedazo nuevo, así la frase sale
 * coherente) y al cerrarse el turno se reutiliza esa traducción sin otra llamada.
 */
export function useLiveTranslation({ enabled, lang, transcript, meetingInterim }: {
  enabled: boolean
  lang: string
  transcript: TranscriptSegment[]
  meetingInterim: string
}) {
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [interimTranslation, setInterimTranslation] = useState<string | null>(null)
  const cacheRef     = useRef(new Map<string, string>()) // texto original → traducción (idioma actual)
  const requestedRef = useRef(new Set<string>())         // ids ya pedidos
  const langRef      = useRef(lang)
  const interimSeqRef = useRef(0)

  // Cambio de idioma o se apagó: se empieza de cero (y se ponen al día los últimos).
  useEffect(() => {
    if (langRef.current === lang && enabled) return
    langRef.current = lang
    cacheRef.current.clear()
    requestedRef.current.clear()
    setTranslations({})
    setInterimTranslation(null)
  }, [lang, enabled])

  // Fragmentos nuevos (los cerrados por turno suelen salir del caché del preview).
  useEffect(() => {
    if (!enabled) return
    const pending = transcript.filter(s => !requestedRef.current.has(s.id)).slice(-CATCH_UP_SEGMENTS)
    transcript.forEach(s => requestedRef.current.add(s.id))
    for (const seg of pending) {
      const cached = cacheRef.current.get(seg.text)
      if (cached || seg.text.trim().split(/\s+/).length < 2) {
        setTranslations(prev => ({ ...prev, [seg.id]: cached ?? seg.text }))
        continue
      }
      const requestLang = langRef.current
      void translate(seg.text, requestLang).then(t => {
        if (!t || requestLang !== langRef.current) return
        cacheRef.current.set(seg.text, t)
        setTranslations(prev => ({ ...prev, [seg.id]: t }))
      })
    }
  }, [enabled, lang, transcript])

  // Turno en curso de la reunión: se traduce con 250 ms de espera; gana el texto más nuevo.
  useEffect(() => {
    if (!enabled) return
    const seq = ++interimSeqRef.current
    if (!meetingInterim) { setInterimTranslation(null); return }
    const timer = setTimeout(async () => {
      const requestLang = langRef.current
      const t = await translate(meetingInterim, requestLang)
      if (!t || seq !== interimSeqRef.current || requestLang !== langRef.current) return
      cacheRef.current.set(meetingInterim, t)
      setInterimTranslation(t)
    }, INTERIM_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, meetingInterim])

  return { translations, interimTranslation }
}
