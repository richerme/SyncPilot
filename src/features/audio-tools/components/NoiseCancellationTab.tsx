'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'syncpilot_audio_settings'

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
    return JSON.parse(raw)
  } catch { return { noiseSuppression: true, echoCancellation: true, autoGainControl: true } }
}

function saveSettings(s: object) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function AudioBar({ level }: { level: number }) {
  const bars = 32
  return (
    <div className="flex items-end gap-0.5 h-10 w-full">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i / bars) * 100
        const active    = level > threshold
        const color     = i < bars * 0.6 ? '#6366F1' : i < bars * 0.8 ? '#F59E0B' : '#EF4444'
        return (
          <div key={i} className="flex-1 rounded-sm transition-all duration-75"
            style={{ height: '100%', background: active ? color : 'var(--color-surface)', opacity: active ? 1 : 0.25 }} />
        )
      })}
    </div>
  )
}

export default function NoiseCancellationTab() {
  const [settings, setSettings] = useState(loadSettings)
  const [isTesting, setIsTesting] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const streamRef   = useRef<MediaStream | null>(null)
  const ctxRef      = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const frameRef    = useRef<number | null>(null)

  useEffect(() => { saveSettings(settings) }, [settings])

  const stopTest = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close().catch(() => {})
    streamRef.current = null; ctxRef.current = null; analyserRef.current = null
    setIsTesting(false); setAudioLevel(0)
  }, [])

  const startTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: settings.noiseSuppression,
          echoCancellation: settings.echoCancellation,
          autoGainControl:  settings.autoGainControl,
          sampleRate: 16000,
        },
        video: false,
      })
      streamRef.current = stream
      const ctx      = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      ctx.createMediaStreamSource(stream).connect(analyser)
      ctxRef.current    = ctx
      analyserRef.current = analyser
      setIsTesting(true)

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setAudioLevel(Math.round((avg / 255) * 100))
        frameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (e) {
      console.error('Mic error:', e)
    }
  }, [settings])

  const toggleSetting = (key: keyof typeof settings) => {
    const next = { ...settings, [key]: !settings[key] }
    setSettings(next)
  }

  const TOGGLES = [
    { key: 'noiseSuppression' as const, label: 'Noise Suppression', icon: '🔇', desc: 'Elimina ruido de fondo (teclado, tráfico, ventiladores)' },
    { key: 'echoCancellation' as const, label: 'Echo Cancellation', icon: '🔄', desc: 'Elimina el eco de altavoces y paredes' },
    { key: 'autoGainControl' as const, label: 'Auto Gain Control', icon: '📶', desc: 'Normaliza el volumen de tu voz automáticamente' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">🎚️ Noise Cancellation</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Configura el procesamiento de audio de tu micrófono. Los cambios se aplican automáticamente en Grabaciones y Sesiones en Vivo.
        </p>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        {TOGGLES.map(t => (
          <div key={t.key} className="flex items-center gap-4 p-4 rounded-xl transition-all"
            style={{
              background: settings[t.key] ? 'rgba(99,102,241,0.1)' : 'var(--color-surface)',
              border: `1px solid ${settings[t.key] ? 'rgba(99,102,241,0.3)' : 'var(--color-surface-border)'}`,
            }}>
            <span className="text-2xl">{t.icon}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{t.label}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t.desc}</p>
            </div>
            <button onClick={() => toggleSetting(t.key)}
              className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
              style={{ background: settings[t.key] ? '#6366F1' : 'var(--color-surface-border)' }}>
              <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ left: settings[t.key] ? '24px' : '4px' }} />
            </button>
          </div>
        ))}
      </div>

      {/* Configuración activa */}
      <div className="p-4 rounded-xl" style={{ background: 'var(--color-surface)' }}>
        <p className="text-xs font-semibold mb-2 text-white">Configuración actual (guardada automáticamente)</p>
        <div className="flex flex-wrap gap-2">
          {TOGGLES.map(t => (
            <span key={t.key} className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: settings[t.key] ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.2)',
                color: settings[t.key] ? '#10B981' : 'var(--color-text-muted)',
              }}>
              {settings[t.key] ? '✓' : '✗'} {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* Test micrófono */}
      <div className="p-4 rounded-xl space-y-4" style={{ background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">🎤 Probar micrófono en vivo</p>
          {!isTesting ? (
            <button onClick={startTest}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: 'rgba(99,102,241,0.2)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.3)' }}>
              Iniciar prueba
            </button>
          ) : (
            <button onClick={stopTest}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              Detener
            </button>
          )}
        </div>
        {isTesting ? (
          <div className="space-y-2">
            <AudioBar level={audioLevel} />
            <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
              Nivel: {audioLevel}% — Habla para ver el medidor en acción
            </p>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Activa la prueba para visualizar el nivel de audio en tiempo real con los filtros aplicados.
          </p>
        )}
      </div>
    </div>
  )
}
