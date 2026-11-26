'use client'

import Link from 'next/link'
import { useRecordingStore } from '@/features/recording/store/recordingStore'

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function RecordingStatusBar() {
  const status   = useRecordingStore(s => s.status)
  const duration = useRecordingStore(s => s.duration)
  const stop     = useRecordingStore(s => s.stopRecording)
  const light    = useRecordingStore(s => s.lightMode)

  if (status !== 'recording' && status !== 'paused') return null

  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-sm"
      style={{
        background: status === 'paused'
          ? 'rgba(245,158,11,0.15)'
          : 'rgba(239,68,68,0.12)',
        borderBottom: `1px solid ${status === 'paused' ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.25)'}`,
      }}
    >
      <div className="flex items-center gap-3">
        {status === 'recording' && <div className="recording-dot" />}
        <span className="font-semibold text-xs" style={{ color: status === 'paused' ? '#F59E0B' : '#F87171' }}>
          {status === 'paused' ? 'Grabación en pausa' : 'Grabando'}
        </span>
        <span className="font-mono text-xs text-white">{formatDuration(duration)}</span>
        {light && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(56,189,248,0.15)', color: '#7DD3FC', border: '1px solid rgba(56,189,248,0.35)' }}
            title="IA en Vivo está activa: la grabación baja a 1 cuadro por segundo y 720p para que la laptop no se quede sin memoria. El audio queda igual. Al apagar IA en Vivo vuelve a lo normal."
          >
            Ligera · 1 fps · 720p
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Link href="/record"
          className="text-xs px-2 py-1 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--color-text-secondary)' }}>
          Ver grabación
        </Link>
        <button
          onClick={stop}
          className="text-xs px-3 py-1 rounded-lg font-semibold"
          style={{ background: 'rgba(239,68,68,0.25)', color: '#F87171', border: '1px solid rgba(239,68,68,0.4)' }}>
          Detener
        </button>
      </div>
    </div>
  )
}
