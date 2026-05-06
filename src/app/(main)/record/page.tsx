'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRecordingStore } from '@/features/recording/store/recordingStore'

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function AudioMeter({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-0.5 h-6">
      {Array.from({ length: 20 }).map((_, i) => {
        const active = level > (i / 20) * 100
        const color = i < 14 ? '#6366F1' : i < 18 ? '#F59E0B' : '#EF4444'
        return (
          <div key={i} className="rounded-sm transition-all duration-75"
            style={{ width: '3px', height: '100%', background: active ? color : 'rgb(42 42 66)', opacity: active ? 1 : 0.3 }} />
        )
      })}
    </div>
  )
}

export default function RecordPage() {
  const [title, setTitle] = useState('Grabación sin título')
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true)
  const [includeWebcam, setIncludeWebcam] = useState(false)

  const status        = useRecordingStore(s => s.status)
  const duration      = useRecordingStore(s => s.duration)
  const audioLevel    = useRecordingStore(s => s.audioLevel)
  const progress      = useRecordingStore(s => s.progress)
  const uploadedBytes = useRecordingStore(s => s.uploadedBytes)
  const totalBytes    = useRecordingStore(s => s.totalBytes)
  const slug          = useRecordingStore(s => s.slug)
  const error         = useRecordingStore(s => s.error)
  const webcamEnabled = useRecordingStore(s => s.webcamEnabled)
  const startRecording  = useRecordingStore(s => s.startRecording)
  const stopRecording   = useRecordingStore(s => s.stopRecording)
  const pauseRecording  = useRecordingStore(s => s.pauseRecording)
  const resumeRecording = useRecordingStore(s => s.resumeRecording)
  const toggleWebcam    = useRecordingStore(s => s.toggleWebcam)
  const reset           = useRecordingStore(s => s.reset)

  const handleStart = useCallback(async () => {
    await startRecording({ title, includeSystemAudio, includeWebcam })
  }, [title, includeSystemAudio, includeWebcam, startRecording])

  const isRecording  = status === 'recording' || status === 'paused'
  const isUploading  = status === 'uploading'
  const isDone       = status === 'done'
  const isRequesting = status === 'requesting-permissions'

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-display-xs font-bold text-white mb-2">Nueva grabación</h1>
      <p className="text-body-sm mb-8" style={{ color: 'var(--color-text-secondary)' }}>
        Captura tu pantalla, audio y (opcional) cámara web.
      </p>

      <div className="card p-6 space-y-6">

        {/* Estado grabando */}
        {isRecording && (
          <div className="flex items-center justify-between p-3 rounded-lg"
            style={{ background: 'rgb(239 68 68 / 0.1)', border: '1px solid rgb(239 68 68 / 0.3)' }}>
            <div className="flex items-center gap-2">
              <div className="recording-dot" />
              <span className="text-sm font-semibold text-red-400">
                {status === 'paused' ? 'PAUSADO' : 'GRABANDO'}
              </span>
            </div>
            <span className="font-mono text-lg font-bold text-white">{formatDuration(duration)}</span>
          </div>
        )}

        {/* Título */}
        {!isRecording && !isUploading && !isDone && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Título de la grabación
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Mi reunión con el equipo..."
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-transparent border transition-colors"
              style={{ borderColor: 'var(--color-surface-border)' }} maxLength={200} />
          </div>
        )}

        {/* Opciones */}
        {!isRecording && !isUploading && !isDone && (
          <div className="space-y-3">
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Opciones de captura</p>
            {[
              { id: 'sys-audio', label: 'Audio del sistema', sub: 'Captura el audio de la reunión', checked: includeSystemAudio, onChange: setIncludeSystemAudio },
              { id: 'webcam',    label: 'Cámara web',        sub: 'Agrega tu imagen en esquina',    checked: includeWebcam,       onChange: setIncludeWebcam },
            ].map(opt => (
              <label key={opt.id} className="flex items-start gap-3 cursor-pointer" htmlFor={opt.id}>
                <div className="relative mt-0.5">
                  <input id={opt.id} type="checkbox" checked={opt.checked}
                    onChange={e => opt.onChange(e.target.checked)} className="sr-only" />
                  <div className="w-5 h-5 rounded flex items-center justify-center transition-all"
                    style={{ background: opt.checked ? '#6366F1' : 'transparent', border: `2px solid ${opt.checked ? '#6366F1' : 'var(--color-surface-border)'}` }}>
                    {opt.checked && (
                      <svg width="12" height="12" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-white font-medium">{opt.label}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{opt.sub}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        {/* Audio meter */}
        {isRecording && (
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Nivel de audio</p>
            <AudioMeter level={audioLevel} />
          </div>
        )}

        {/* Upload progress */}
        {isUploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <span>Subiendo video...</span><span>{progress}%</span>
            </div>
            <div className="upload-progress">
              <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
            </p>
          </div>
        )}

        {/* Done */}
        {isDone && slug && (
          <div className="rounded-lg p-4 space-y-3"
            style={{ background: 'rgb(16 185 129 / 0.1)', border: '1px solid rgb(16 185 129 / 0.3)' }}>
            <p className="text-sm font-semibold text-green-400">✓ ¡Grabación completada!</p>
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--color-surface)' }}>
              <code className="text-xs text-white flex-1 truncate">
                {typeof window !== 'undefined' && window.location.origin}/v/{slug}
              </code>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/v/${slug}`)}
                className="text-xs px-2 py-1 rounded font-medium"
                style={{ background: '#6366F1', color: 'white' }}>
                Copiar
              </button>
            </div>
            <Link href={`/v/${slug}`} className="text-xs font-medium" style={{ color: '#818CF8' }}>
              Ver grabación →
            </Link>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg p-3 text-sm"
            style={{ background: 'rgb(239 68 68 / 0.1)', border: '1px solid rgb(239 68 68 / 0.3)', color: '#F87171' }}>
            {error}
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-3">
          {!isRecording && !isUploading && !isDone && (
            <button onClick={handleStart} disabled={isRequesting}
              className="btn-record flex items-center gap-2 flex-1 justify-center py-3">
              {isRequesting ? (
                <><svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="60 30" /></svg>
                  Preparando...</>
              ) : (
                <><svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="white" /></svg>
                  Iniciar grabación</>
              )}
            </button>
          )}

          {isRecording && (
            <>
              <button onClick={stopRecording} className="btn-record flex items-center gap-2 flex-1 justify-center py-3">
                <svg width="16" height="16" fill="white" viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                Detener
              </button>
              <button
                onClick={status === 'recording' ? pauseRecording : resumeRecording}
                className="px-4 py-3 rounded-lg transition-all text-sm font-medium"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                {status === 'recording' ? 'Pausar' : 'Reanudar'}
              </button>
              <button onClick={toggleWebcam}
                className="px-3 py-3 rounded-lg transition-all"
                style={{ background: 'var(--color-surface)', color: webcamEnabled ? '#818CF8' : 'var(--color-text-muted)' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              </button>
              <Link href="/live"
                className="px-3 py-3 rounded-lg flex items-center justify-center"
                style={{ background: 'rgb(99 102 241/0.15)', border: '1px solid rgb(99 102 241/0.3)', color: '#818CF8' }}>
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                </svg>
              </Link>
            </>
          )}

          {isDone && (
            <button onClick={reset} className="btn-primary flex items-center gap-2 flex-1 justify-center py-3">
              Nueva grabación
            </button>
          )}
        </div>

        {isRecording && (
          <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            💡 Puedes navegar a{' '}
            <Link href="/live" style={{ color: '#818CF8' }}>IA en Vivo</Link>
            {' '}sin interrumpir la grabación
          </p>
        )}
      </div>

      {!isRecording && !isUploading && !isDone && (
        <div className="mt-6 p-4 rounded-lg text-xs space-y-1"
          style={{ background: 'var(--color-bg-overlay)', border: '1px solid var(--color-surface-border)' }}>
          <p className="font-medium text-white mb-2">💡 Consejos</p>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            • El navegador te pedirá elegir qué ventana o pantalla compartir.
          </p>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            • Activa &quot;Compartir audio del sistema&quot; para capturar el audio de la reunión.
          </p>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            • En Chrome/Edge el audio del sistema solo está disponible al compartir una pestaña.
          </p>
        </div>
      )}
    </div>
  )
}
