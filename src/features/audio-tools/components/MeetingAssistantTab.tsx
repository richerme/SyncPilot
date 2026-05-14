'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { MeetingAnalysis } from '../types'
import { analyzeMeeting, getSavedMeetingAnalysis } from '../services/audioToolsApi'

interface Meeting { id: string; title: string | null; startedAt: string; wordCount: number; durationSecs: number | null }

const SENTIMENT_CONFIG = {
  positive: { label: 'Positivo',  color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  neutral:  { label: 'Neutral',   color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  negative: { label: 'Negativo',  color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
}

export default function MeetingAssistantTab({ userId }: { userId: string }) {
  const [meetings, setMeetings]   = useState<Meeting[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading]     = useState(false)
  const [loadingMeetings, setLoadingMeetings] = useState(true)
  const [result, setResult]       = useState<MeetingAnalysis | null>(null)
  const [error, setError]         = useState('')

  useEffect(() => {
    fetch('/api/meetings').then(r => r.json()).then(d => {
      setMeetings(d.meetings ?? [])
    }).catch(() => {}).finally(() => setLoadingMeetings(false))
  }, [])

  async function loadMeeting(id: string) {
    setSelectedId(id); setResult(null); setError('')
    const saved = await getSavedMeetingAnalysis(id)
    if (saved) setResult(saved)
  }

  async function runAnalysis() {
    if (!selectedId) return
    setLoading(true); setError('')
    try {
      const analysis = await analyzeMeeting(selectedId)
      setResult(analysis)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al analizar')
    } finally {
      setLoading(false)
    }
  }

  const selectedMeeting = meetings.find(m => m.id === selectedId)
  const sentiment = result ? SENTIMENT_CONFIG[result.sentiment] ?? SENTIMENT_CONFIG.neutral : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">📊 Meeting Assistant Pro</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Selecciona una reunión de tu historial y obtén un análisis enriquecido: decisiones, próximos pasos, participantes, tensiones y sentimiento.
        </p>
      </div>

      {/* Meeting selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Selecciona una reunión
        </label>
        {loadingMeetings ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Cargando reuniones...</p>
        ) : meetings.length === 0 ? (
          <div className="p-4 rounded-xl text-center" style={{ background: 'var(--color-surface)' }}>
            <p className="text-sm text-white mb-2">Sin reuniones con transcripción</p>
            <Link href="/live" className="text-xs" style={{ color: '#818CF8' }}>
              Inicia una sesión en IA en Vivo →
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {meetings.map(m => (
              <button key={m.id} onClick={() => loadMeeting(m.id)}
                className="w-full text-left p-3 rounded-xl transition-all flex items-center gap-3"
                style={{
                  background: selectedId === m.id ? 'rgba(99,102,241,0.15)' : 'var(--color-surface)',
                  border: `1px solid ${selectedId === m.id ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
                }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(99,102,241,0.2)' }}>🧠</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{m.title ?? 'Reunión sin título'}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(m.startedAt).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {m.wordCount > 0 && ` · ${m.wordCount.toLocaleString()} palabras`}
                  </p>
                </div>
                {selectedId === m.id && <span className="text-indigo-400 text-sm">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedId && !result && (
        <div className="flex gap-2">
          <button onClick={runAnalysis} disabled={loading}
            className="btn-primary flex items-center gap-2 px-6 py-2.5 disabled:opacity-50">
            {loading ? (
              <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="60 30" /></svg>
                Analizando reunión...</>
            ) : '📊 Analizar con IA'}
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ background: 'rgb(239 68 68/0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4 animate-fade-in">
          {/* Header del resultado */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{selectedMeeting?.title ?? 'Análisis'}</h3>
            <div className="flex items-center gap-2">
              {sentiment && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: sentiment.bg, color: sentiment.color }}>
                  {sentiment.label} · {result.sentimentScore}/100
                </span>
              )}
              <button onClick={runAnalysis} disabled={loading}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                Re-analizar
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 rounded-xl space-y-2" style={{ background: 'var(--color-surface)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>Resumen Ejecutivo</p>
            <p className="text-sm leading-relaxed text-white">{result.executiveSummary}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Decisions */}
            {result.decisions?.length > 0 && (
              <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: '#10B981' }}>✅ Decisiones tomadas</p>
                <ul className="space-y-1.5">
                  {result.decisions.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-400 flex-shrink-0 mt-0.5">•</span>
                      <span style={{ color: 'var(--color-text)' }}>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next steps */}
            {result.nextSteps?.length > 0 && (
              <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: '#818CF8' }}>📋 Próximos pasos</p>
                <ul className="space-y-1.5">
                  {result.nextSteps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="w-4 h-4 rounded border flex-shrink-0 mt-0.5"
                        style={{ borderColor: 'rgba(99,102,241,0.4)' }} />
                      <span style={{ color: 'var(--color-text)' }}>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Participants */}
            {result.participants?.length > 0 && (
              <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: '#06B6D4' }}>👥 Participantes detectados</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.participants.map((p, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(6,182,212,0.15)', color: '#06B6D4' }}>{p}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Tension points */}
            {result.tensionPoints?.length > 0 && (
              <div className="p-4 rounded-xl space-y-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: '#F59E0B' }}>⚠️ Puntos de tensión</p>
                <ul className="space-y-1.5">
                  {result.tensionPoints.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-amber-400 flex-shrink-0">•</span>
                      <span style={{ color: 'var(--color-text)' }}>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Topics */}
          {result.keyTopics?.length > 0 && (
            <div className="p-4 rounded-xl space-y-2" style={{ background: 'var(--color-surface)' }}>
              <p className="text-xs font-semibold text-white">🏷️ Temas clave</p>
              <div className="flex flex-wrap gap-1.5">
                {result.keyTopics.map((t, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--color-surface-border)', color: 'var(--color-text-secondary)' }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
