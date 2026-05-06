'use client'

import { useState } from 'react'
import type { AccentAnalysis } from '../types'
import { detectLanguage } from '../services/audioToolsApi'
import { useAudioRecorder } from '../hooks/useAudioRecorder'

function ScoreBar({ score, label, color = '#6366F1' }: { score: number; label: string; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        <span className="font-bold text-white">{score}/100</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  )
}

export default function AccentDetectorTab() {
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<AccentAnalysis | null>(null)
  const [error, setError]       = useState('')
  const recorder = useAudioRecorder(15)

  async function analyze() {
    if (!recorder.audioBase64) return
    setLoading(true); setError(''); setResult(null)
    try {
      const analysis = await detectLanguage(recorder.audioBase64, recorder.mimeType)
      setResult(analysis)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al analizar')
    } finally {
      setLoading(false)
    }
  }

  const clarityColor = result
    ? result.clarityScore >= 75 ? '#10B981'
    : result.clarityScore >= 50 ? '#F59E0B' : '#EF4444'
    : '#6366F1'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">🔍 Language & Accent Detector</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Graba 10-15 segundos hablando naturalmente. La IA detectará tu idioma, acento, región y te dará sugerencias de mejora.
        </p>
      </div>

      {/* Recorder */}
      <div className="p-6 rounded-xl text-center space-y-4" style={{ background: 'var(--color-surface)' }}>
        {!recorder.isRecording && !recorder.audioBase64 && (
          <div className="space-y-3">
            <div className="text-5xl">🎤</div>
            <p className="text-sm font-medium text-white">Presiona para grabar 10-15 segundos</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Habla de forma natural, como si contaras algo a alguien.
            </p>
            <button onClick={recorder.startRecording}
              className="btn-record flex items-center gap-2 mx-auto px-6 py-3">
              <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
              </svg>
              Iniciar grabación
            </button>
          </div>
        )}

        {recorder.isRecording && (
          <div className="space-y-4">
            <div className="recording-dot mx-auto" />
            <div className="text-4xl font-bold text-white">{recorder.countdown}s</div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-border)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${((15 - recorder.countdown) / 15) * 100}%`, background: '#EF4444' }} />
            </div>
            <button onClick={recorder.stopRecording}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--color-surface-border)', color: 'var(--color-text)' }}>
              Detener grabación
            </button>
          </div>
        )}

        {recorder.audioBase64 && !recorder.isRecording && (
          <div className="space-y-3">
            <div className="text-4xl">✅</div>
            <p className="text-sm text-white">Grabación lista. ¿Analizar?</p>
            <div className="flex gap-2 justify-center">
              <button onClick={recorder.reset}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: 'var(--color-surface-border)', color: 'var(--color-text)' }}>
                Volver a grabar
              </button>
              <button onClick={analyze} disabled={loading}
                className="btn-primary px-6 py-2">
                {loading ? 'Analizando...' : '🔍 Analizar acento'}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-3 justify-center py-4">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#6366F1" strokeWidth="3" strokeDasharray="60 30" />
          </svg>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Analizando idioma y acento...
          </span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ background: 'rgb(239 68 68/0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4 animate-fade-in">
          {/* Main card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl text-center space-y-1"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
              <p className="text-3xl">🌐</p>
              <p className="text-lg font-bold text-white">{result.detectedLanguage}</p>
              <p className="text-xs font-mono px-2 py-0.5 rounded"
                style={{ background: 'rgba(99,102,241,0.2)', color: '#818CF8' }}>
                {result.languageCode.toUpperCase()}
              </p>
            </div>
            <div className="p-4 rounded-xl text-center space-y-1"
              style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
              <p className="text-3xl">🗣️</p>
              <p className="text-base font-bold text-white">{result.accentProbable}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Acento probable</p>
            </div>
            <div className="p-4 rounded-xl text-center space-y-1"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <p className="text-3xl">📍</p>
              <p className="text-base font-bold text-white">{result.estimatedRegion}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Región estimada</p>
            </div>
          </div>

          {/* Scores */}
          <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-surface)' }}>
            <ScoreBar score={result.clarityScore}  label="Claridad de comunicación"  color={clarityColor} />
            <ScoreBar score={result.confidence}    label="Confianza del análisis"     color="#6366F1" />
          </div>

          {/* Suggestions */}
          <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--color-surface)' }}>
            <p className="text-sm font-semibold text-white">💡 Sugerencias de mejora</p>
            {result.suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{ background: '#6366F1', color: 'white' }}>{i + 1}</span>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{s}</p>
              </div>
            ))}
          </div>

          <button onClick={() => { setResult(null); recorder.reset() }}
            className="text-sm px-4 py-2 rounded-lg"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            Analizar otra muestra
          </button>
        </div>
      )}
    </div>
  )
}
