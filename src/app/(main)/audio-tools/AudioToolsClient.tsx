'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { AudioToolTab } from '@/features/audio-tools/types'

const AudioTranslatorTab  = dynamic(() => import('@/features/audio-tools/components/AudioTranslatorTab'),  { ssr: false })
const AccentDetectorTab   = dynamic(() => import('@/features/audio-tools/components/AccentDetectorTab'),   { ssr: false })
const MeetingAssistantTab = dynamic(() => import('@/features/audio-tools/components/MeetingAssistantTab'), { ssr: false })
const NoiseCancellationTab = dynamic(() => import('@/features/audio-tools/components/NoiseCancellationTab'), { ssr: false })
const LiveTranslatorTab   = dynamic(() => import('@/features/audio-tools/components/LiveTranslatorTab'),   { ssr: false })

const TABS: { id: AudioToolTab; icon: string; label: string; sub: string }[] = [
  { id: 'translator', icon: '🔊', label: 'Audio Translator',     sub: 'Audio → texto + voz en otro idioma' },
  { id: 'detector',   icon: '🔍', label: 'Accent Detector',      sub: 'Detecta idioma, acento y región' },
  { id: 'meeting',    icon: '📊', label: 'Meeting Assistant Pro', sub: 'Análisis enriquecido post-reunión' },
  { id: 'noise',      icon: '🎚️', label: 'Noise Cancellation',   sub: 'Cancelación de ruido profesional' },
  { id: 'live',       icon: '🌐', label: 'Live Translator',       sub: 'Configurar traducción en vivo' },
]

export default function AudioToolsClient({ userId, userName }: { userId: string; userName: string }) {
  const [activeTab, setActiveTab] = useState<AudioToolTab>('translator')

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
            <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            </svg>
          </div>
          <div>
            <h1 className="text-display-xs font-bold text-white">Voice AI Tools</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Inspirado en utell.ai · 100% web · Powered by OpenRouter + OpenAI TTS
            </p>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-shrink-0 flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
            style={{
              background:   activeTab === tab.id ? 'rgba(99,102,241,0.15)' : 'var(--color-bg-card)',
              border:       `1px solid ${activeTab === tab.id ? 'rgba(99,102,241,0.4)' : 'var(--color-surface-border)'}`,
              minWidth:     '160px',
            }}>
            <span className="text-xl flex-shrink-0 mt-0.5">{tab.icon}</span>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{tab.label}</p>
              <p className="text-xs mt-0.5 leading-tight" style={{ color: 'var(--color-text-muted)' }}>{tab.sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="card p-6">
        {activeTab === 'translator' && <AudioTranslatorTab />}
        {activeTab === 'detector'   && <AccentDetectorTab />}
        {activeTab === 'meeting'    && <MeetingAssistantTab userId={userId} />}
        {activeTab === 'noise'      && <NoiseCancellationTab />}
        {activeTab === 'live'       && <LiveTranslatorTab />}
      </div>
    </div>
  )
}
