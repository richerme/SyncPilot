'use client'

import { useEffect, useState } from 'react'
import type { SupportedLanguage } from '../types'
import { LANGUAGE_LABELS } from '../types'

const STORAGE_LANG_KEY = 'syncpilot_live_translator_lang'
const STORAGE_EN_KEY   = 'syncpilot_live_translator_enabled'

export default function LiveTranslatorTab() {
  const [enabled, setEnabled]   = useState(false)
  const [lang, setLang]         = useState<SupportedLanguage>('es')

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(STORAGE_EN_KEY) === 'true')
      const saved = localStorage.getItem(STORAGE_LANG_KEY) as SupportedLanguage | null
      if (saved) setLang(saved)
    } catch { /* ignore */ }
  }, [])

  function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    try { localStorage.setItem(STORAGE_EN_KEY, String(next)) } catch { /* ignore */ }
  }

  function changeLang(l: SupportedLanguage) {
    setLang(l)
    try { localStorage.setItem(STORAGE_LANG_KEY, l) } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">🌐 Live Translator</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Activa la traducción en tiempo real para la página <strong className="text-white">IA en Vivo</strong>. Cada segmento del transcript se traduce automáticamente al idioma que elijas.
        </p>
      </div>

      {/* Toggle principal */}
      <div className="flex items-center justify-between p-5 rounded-xl"
        style={{
          background: enabled ? 'rgba(99,102,241,0.12)' : 'var(--color-surface)',
          border: `2px solid ${enabled ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
        }}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{enabled ? '🌐' : '🌐'}</span>
          <div>
            <p className="text-base font-bold text-white">Traducción en Vivo</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {enabled ? `Activa · Traduce al ${LANGUAGE_LABELS[lang]}` : 'Inactiva · Los segmentos no se traducen'}
            </p>
          </div>
        </div>
        <button onClick={toggleEnabled}
          className="relative w-14 h-7 rounded-full transition-colors flex-shrink-0"
          style={{ background: enabled ? '#6366F1' : 'var(--color-surface-border)' }}>
          <div className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-transform"
            style={{ left: enabled ? '32px' : '4px' }} />
        </button>
      </div>

      {/* Idioma destino */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Idioma destino de la traducción
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
      <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-surface)' }}>
        <p className="text-sm font-semibold text-white">Cómo funciona</p>
        <div className="space-y-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <div className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold flex-shrink-0">1.</span>
            <span>Activa la traducción aquí con el toggle y selecciona el idioma destino.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold flex-shrink-0">2.</span>
            <span>Ve a <strong className="text-white">IA en Vivo</strong> e inicia tu sesión normalmente.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold flex-shrink-0">3.</span>
            <span>Cada fragmento transcrito mostrará la traducción debajo en cursiva.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-indigo-400 font-bold flex-shrink-0">4.</span>
            <span>La latencia de traducción es ~1-2 segundos adicionales por segmento.</span>
          </div>
        </div>
      </div>

      {enabled && (
        <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <p className="text-sm font-semibold" style={{ color: '#10B981' }}>
            ✓ Configuración guardada
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Traduce al <strong className="text-white">{LANGUAGE_LABELS[lang]}</strong> — activo en tu próxima sesión en vivo.
          </p>
          <a href="/live" className="btn-primary inline-flex items-center gap-2 mt-3 text-sm px-5 py-2">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Ir a IA en Vivo
          </a>
        </div>
      )}
    </div>
  )
}
