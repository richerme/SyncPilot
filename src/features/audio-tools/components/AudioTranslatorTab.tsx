'use client'

import { useState, useRef, useCallback } from 'react'
import type { SupportedLanguage, TranslationResult } from '../types'
import { LANGUAGE_LABELS } from '../types'
import { translateAudio } from '../services/audioToolsApi'
import { useAudioRecorder } from '../hooks/useAudioRecorder'

const ACCEPTED_TYPES = '.mp3,.wav,.mp4,.webm,.m4a,.ogg,.flac'
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

export default function AudioTranslatorTab() {
  const [targetLang, setTargetLang]   = useState<SupportedLanguage>('es')
  const [withTTS, setWithTTS]         = useState(true)
  const [voice, setVoice]             = useState<'nova'|'alloy'|'shimmer'>('nova')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<TranslationResult | null>(null)
  const [error, setError]             = useState('')
  const [audioUrl, setAudioUrl]       = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorder     = useAudioRecorder(30)

  const processAudio = useCallback(async (base64: string, mimeType: string) => {
    setLoading(true); setError(''); setResult(null); setAudioUrl(null)
    try {
      const res = await translateAudio(base64, mimeType, targetLang, withTTS)
      setResult(res)
      if (res.audioBase64) {
        const blob = new Blob([Uint8Array.from(atob(res.audioBase64), c => c.charCodeAt(0))], { type: 'audio/wav' })
        setAudioUrl(URL.createObjectURL(blob))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al procesar')
    } finally {
      setLoading(false)
    }
  }, [targetLang, withTTS])

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) { setError('El archivo es muy grande (máx 20 MB)'); return }
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      processAudio(base64, file.type || 'audio/webm')
    }
    reader.readAsDataURL(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function downloadText() {
    if (!result) return
    const text = `ORIGINAL:\n${result.originalText}\n\nTRADUCCIÓN (${result.targetLang}):\n${result.translatedText}`
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'traduccion.txt'; a.click()
  }

  function downloadAudio() {
    if (!audioUrl) return
    const a = document.createElement('a'); a.href = audioUrl; a.download = 'traduccion.wav'; a.click()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">🔊 Audio Translator</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Sube un archivo de audio o graba tu voz → transcripción + traducción + síntesis de voz en el idioma destino.
        </p>
      </div>

      {/* Opciones */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="space-y-1">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Idioma destino</label>
          <select value={targetLang} onChange={e => setTargetLang(e.target.value as SupportedLanguage)}
            className="input-field text-sm py-1.5 w-40">
            {Object.entries(LANGUAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Voz TTS</label>
          <select value={voice} onChange={e => setVoice(e.target.value as 'nova'|'alloy'|'shimmer')}
            className="input-field text-sm py-1.5 w-36">
            <option value="nova">Nova (cálida)</option>
            <option value="alloy">Alloy (neutral)</option>
            <option value="shimmer">Shimmer (suave)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer mt-4">
          <div className="relative">
            <input type="checkbox" checked={withTTS} onChange={e => setWithTTS(e.target.checked)} className="sr-only" />
            <div className="w-10 h-5 rounded-full transition-colors" style={{ background: withTTS ? '#6366F1' : 'var(--color-surface)' }} />
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow"
              style={{ left: withTTS ? '22px' : '2px' }} />
          </div>
          <span className="text-sm text-white">Generar audio (TTS)</span>
        </label>
      </div>

      {/* Upload zone */}
      <div
        onDrop={handleDrop} onDragOver={e => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all hover:border-indigo-500/50"
        style={{ borderColor: 'var(--color-surface-border)' }}>
        <div className="text-4xl mb-2">📂</div>
        <p className="text-sm font-medium text-white">Arrastra un archivo o haz clic para seleccionar</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>MP3, WAV, MP4, WebM, M4A, OGG, FLAC — máx 20 MB</p>
        <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </div>

      {/* Grabar */}
      <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'var(--color-surface)' }}>
        <span className="text-2xl">🎙️</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">O graba directamente</p>
          {recorder.isRecording
            ? <p className="text-xs" style={{ color: '#F59E0B' }}>Grabando... {recorder.countdown}s restantes</p>
            : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Hasta 30 segundos de voz</p>}
        </div>
        {!recorder.isRecording ? (
          <button onClick={recorder.startRecording}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
            Grabar
          </button>
        ) : (
          <button onClick={() => { recorder.stopRecording(); setTimeout(() => { if (recorder.audioBase64) processAudio(recorder.audioBase64, recorder.mimeType) }, 500) }}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            Detener
          </button>
        )}
        {recorder.audioBase64 && !recorder.isRecording && (
          <button onClick={() => processAudio(recorder.audioBase64!, recorder.mimeType)}
            className="btn-primary text-sm px-4 py-2">
            Traducir grabación
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-4 justify-center">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#6366F1" strokeWidth="3" strokeDasharray="60 30" />
          </svg>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Transcribiendo, traduciendo y sintetizando voz...
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ background: 'rgb(239 68 68/0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
          {error}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl space-y-2" style={{ background: 'var(--color-surface)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                Original ({result.detectedLang})
              </p>
              <p className="text-sm text-white leading-relaxed">{result.originalText}</p>
            </div>
            <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>
                Traducción ({LANGUAGE_LABELS[result.targetLang as SupportedLanguage] ?? result.targetLang})
              </p>
              <p className="text-sm text-white leading-relaxed">{result.translatedText}</p>
            </div>
          </div>

          {audioUrl && (
            <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <p className="text-xs font-semibold" style={{ color: '#10B981' }}>🎵 Audio sintetizado</p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={audioUrl} className="w-full" style={{ height: '36px' }} />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={downloadText}
              className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              📄 Descargar texto
            </button>
            {audioUrl && (
              <button onClick={downloadAudio}
                className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                style={{ background: 'rgba(16,185,129,0.15)', color: '#10B981', border: '1px solid rgba(16,185,129,0.3)' }}>
                🎵 Descargar audio
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
