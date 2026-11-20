'use client'

import { LANGUAGE_LABELS } from '@/features/audio-tools/types'

// Idiomas que se cambian dentro de IA en Vivo sin cortar la reunión (PRP-005, fase 2).
// Valen solo para esta reunión (decisión 3b): el predeterminado sigue en Voice AI → Live Translator.

export const VOICE_LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'es-MX', label: 'Español' },
] as const

const selectStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-surface-border)',
  color: 'var(--color-text)',
} as const

interface Props {
  translatorEnabled: boolean
  translatorLang: string
  onToggleTranslator: () => void
  onTranslatorLang: (lang: string) => void
  /** Solo con la sesión activa: el idioma de tu micrófono. */
  voiceLang?: string
  onVoiceLang?: (code: string) => void
}

export default function LiveLanguageBar({ translatorEnabled, translatorLang, onToggleTranslator, onTranslatorLang, voiceLang, onVoiceLang }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <button onClick={onToggleTranslator} aria-pressed={translatorEnabled}
        title={translatorEnabled ? 'Ocultar la traducción (solo en esta reunión)' : 'Mostrar la traducción (solo en esta reunión)'}
        className="px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
        style={translatorEnabled
          ? { background: 'rgba(6,182,212,0.15)', color: '#06B6D4', border: '1px solid rgba(6,182,212,0.3)' }
          : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-surface-border)' }}>
        🌐 {translatorEnabled ? 'Trad.' : 'Sin trad.'}
      </button>
      {translatorEnabled && (
        <label className="flex items-center gap-1">
          <span className="sr-only">Idioma de la traducción</span>
          <select id="live-translate-lang" value={translatorLang} onChange={e => onTranslatorLang(e.target.value)}
            title="Idioma de la traducción, solo para esta reunión" className="rounded-md px-1.5 py-0.5 text-xs" style={selectStyle}>
            {Object.entries(LANGUAGE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      )}
      {voiceLang && onVoiceLang && (
        <label className="flex items-center gap-1" title="Idioma en el que hablas tú (micrófono), solo para esta reunión">
          <span style={{ color: 'var(--color-text-muted)' }}>🎙️</span>
          <select id="live-voice-lang" value={voiceLang} onChange={e => onVoiceLang(e.target.value)}
            className="rounded-md px-1.5 py-0.5 text-xs" style={selectStyle}>
            {VOICE_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
