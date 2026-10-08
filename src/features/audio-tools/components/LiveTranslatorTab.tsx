'use client'

import { memo, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { SupportedLanguage } from '../types'
import { LANGUAGE_LABELS } from '../types'
import { useLiveTranslation, type TranslatedSegment } from '../hooks/useLiveTranslation'

const STORAGE_LANG_KEY = 'syncpilot_live_translator_lang'
const STORAGE_EN_KEY   = 'syncpilot_live_translator_enabled'

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

const Row = memo(function Row({ seg }: { seg: TranslatedSegment }) {
  const me = seg.speaker === 'me'
  return (
    <div className="grid grid-cols-[3rem_1fr] gap-2 py-1.5">
      <span className="text-xs pt-0.5" style={{ color: 'var(--color-text-muted)' }}>{fmt(seg.startMs)}</span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-base leading-snug break-words" style={{ color: me ? '#A5B4FC' : '#67E8F9' }}>
          {seg.translated ?? <span className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>Traduciendo…</span>}
        </p>
        <p className="text-xs break-words" style={{ color: 'var(--color-text-muted)' }}>
          <span className="font-semibold">{me ? 'Tú' : 'Reunión'}:</span> {seg.text}
        </p>
      </div>
    </div>
  )
})

export default function LiveTranslatorTab() {
  const [enabled, setEnabled] = useState(false)
  const [lang, setLang]       = useState<SupportedLanguage>('es')
  const { active, segments, interim, supported } = useLiveTranslation(lang)
  const listRef  = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(STORAGE_EN_KEY) === 'true')
      const saved = localStorage.getItem(STORAGE_LANG_KEY) as SupportedLanguage | null
      if (saved && saved in LANGUAGE_LABELS) setLang(saved)
    } catch { /* ignore */ }
  }, [])

  // Siempre a la vista lo último, salvo que el usuario haya subido a leer algo anterior.
  useEffect(() => {
    const c = listRef.current
    if (c && atBottom.current) c.scrollTop = c.scrollHeight
  }, [segments, interim])

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white mb-1">🌐 Live Translator</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Traduce en vivo la reunión que tienes abierta en <strong className="text-white">IA en Vivo</strong> (mismo navegador, otra pestaña o ventana).
          </p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium"
          style={{ background: active ? 'rgb(16 185 129/0.1)' : 'var(--color-surface)', color: active ? '#10B981' : 'var(--color-text-muted)' }}>
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
          {active ? 'Reunión en vivo' : 'Sin reunión activa'}
        </span>
      </div>

      {/* Idioma destino */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(LANGUAGE_LABELS) as [SupportedLanguage, string][]).map(([code, label]) => (
          <button key={code} onClick={() => changeLang(code)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: lang === code ? 'rgba(99,102,241,0.2)' : 'var(--color-surface)',
              border: `1px solid ${lang === code ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
              color: lang === code ? '#818CF8' : 'var(--color-text)',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Traducción en vivo */}
      <div ref={listRef}
        onScroll={() => {
          const c = listRef.current
          if (c) atBottom.current = c.scrollHeight - c.scrollTop - c.clientHeight < 80
        }}
        className="h-[52vh] min-h-[280px] overflow-y-auto rounded-xl p-4 divide-y divide-white/5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)' }}>
        {!supported ? (
          <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-muted)' }}>Este navegador no permite conectar pestañas. Usa Chrome o Edge.</p>
        ) : segments.length === 0 && !interim ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <p className="text-sm text-white">{active ? 'Escuchando la reunión…' : 'Aquí aparecerá la traducción de la reunión.'}</p>
            {!active && (
              <Link href="/live" target="_blank" className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2">
                Abrir IA en Vivo en otra pestaña
              </Link>
            )}
          </div>
        ) : (
          <>
            {segments.map(seg => <Row key={seg.id} seg={seg} />)}
            {interim && (
              <div className="grid grid-cols-[3rem_1fr] gap-2 py-1.5 opacity-80">
                <span className="text-xs pt-0.5" style={{ color: 'var(--color-text-muted)' }}>•••</span>
                <div className="min-w-0 space-y-0.5">
                  {interim.speaker === 'meeting' && (
                    <p className="text-base leading-snug break-words italic" style={{ color: '#67E8F9' }}>{interim.translated ?? '…'}</p>
                  )}
                  <p className="text-xs break-words italic" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="font-semibold">{interim.speaker === 'me' ? 'Tú' : 'Reunión'}:</span> {interim.text}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* También en IA en Vivo */}
      <label className="flex items-center justify-between gap-3 p-3 rounded-xl cursor-pointer"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-surface-border)' }}>
        <span className="text-sm">
          <span className="text-white font-medium">Mostrar también la traducción en IA en Vivo</span>
          <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>Agrega una columna traducida junto a la transcripción (se aplica al abrir IA en Vivo).</span>
        </span>
        <button type="button" onClick={toggleEnabled} aria-pressed={enabled}
          className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
          style={{ background: enabled ? '#6366F1' : 'var(--color-surface-border)' }}>
          <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all" style={{ left: enabled ? '26px' : '2px' }} />
        </button>
      </label>
    </div>
  )
}
