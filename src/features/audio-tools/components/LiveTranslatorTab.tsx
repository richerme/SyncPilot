'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { SupportedLanguage } from '../types'
import { LANGUAGE_LABELS } from '../types'
import { TRANSLATOR_ENABLED_KEY, TRANSLATOR_LANG_KEY } from '@/features/live/hooks/useLiveTranslation'

// Solo configuración: la traducción se ve en IA en Vivo, a la derecha de la transcripción.
export default function LiveTranslatorTab() {
  const [enabled, setEnabled] = useState(false)
  const [lang, setLang]       = useState<SupportedLanguage>('es')

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(TRANSLATOR_ENABLED_KEY) === 'true')
      const saved = localStorage.getItem(TRANSLATOR_LANG_KEY) as SupportedLanguage | null
      if (saved && saved in LANGUAGE_LABELS) setLang(saved)
    } catch { /* ignore */ }
  }, [])

  function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    try { localStorage.setItem(TRANSLATOR_ENABLED_KEY, String(next)) } catch { /* ignore */ }
  }

  function changeLang(l: SupportedLanguage) {
    setLang(l)
    try { localStorage.setItem(TRANSLATOR_LANG_KEY, l) } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">🌐 Live Translator</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Muestra la traducción en <strong className="text-white">IA en Vivo</strong>, en un panel a la derecha de la transcripción: escuchas y lees el original, y si algo no se entiende tienes la traducción al lado.
        </p>
      </div>

      {/* Toggle principal */}
      <div className="flex items-center justify-between gap-4 p-5 rounded-xl"
        style={{
          background: enabled ? 'rgba(99,102,241,0.12)' : 'var(--color-surface)',
          border: `2px solid ${enabled ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
        }}>
        <div>
          <p className="text-base font-bold text-white">Mostrar también la traducción en IA en Vivo</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {enabled ? `Activa · Traduce al ${LANGUAGE_LABELS[lang]}` : 'Inactiva · IA en Vivo muestra solo la transcripción'}
          </p>
        </div>
        <button onClick={toggleEnabled} aria-pressed={enabled} aria-label="Mostrar también la traducción en IA en Vivo"
          className="relative w-14 h-7 rounded-full transition-colors flex-shrink-0"
          style={{ background: enabled ? '#6366F1' : 'var(--color-surface-border)' }}>
          <div className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all"
            style={{ left: enabled ? '32px' : '4px' }} />
        </button>
      </div>

      {/* Idioma destino */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Idioma de la traducción
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(LANGUAGE_LABELS) as [SupportedLanguage, string][]).map(([code, label]) => (
            <button key={code} onClick={() => changeLang(code)}
              className="p-3 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: lang === code ? 'rgba(99,102,241,0.2)' : 'var(--color-surface)',
                border: `1px solid ${lang === code ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
                color: lang === code ? '#818CF8' : 'var(--color-text)',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="p-4 rounded-xl space-y-2 text-xs" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
        <p className="text-sm font-semibold text-white">Cómo se ve</p>
        <p>IA en Vivo se divide en dos: a la izquierda la transcripción de la reunión y a la derecha la traducción, que aparece mientras hablan (≈ 1 s después de cada frase).</p>
        <p>Los cambios aplican al momento, incluso con IA en Vivo ya abierta.</p>
      </div>

      <Link href="/live" className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2">
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Ir a IA en Vivo
      </Link>
    </div>
  )
}
