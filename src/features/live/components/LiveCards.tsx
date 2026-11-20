'use client'

import Link from 'next/link'
import { memo, useState } from 'react'
import type { CopilotAnswer, MeetingContextInfo, TranscriptSegment } from '@/features/live/hooks/useLiveSession'

// Piezas de la pantalla de IA en Vivo (renglones de la transcripción y tarjetas del Copiloto).
// Salieron de app/live/page.tsx el 19 nov (PRP-005) para que la página no pase de 500 líneas.

export function fmtDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

const TRIGGER_LABEL: Record<CopilotAnswer['trigger'], string> = {
  name: 'Te nombraron', button: 'Responder', typed: 'Tu pregunta', context: '🔎 Lo que se está hablando',
}

// Colores de speaker
const SPEAKER_STYLES = {
  me:      { color: '#818CF8', label: 'Tú' },       // Índigo (voz propia)
  meeting: { color: '#e2e8f0', label: 'Reunión' },  // Blanco (audio de reunión)
  null:    { color: '#e2e8f0', label: '' },
}

// Cada fila memoizada por separado: al llegar un fragmento nuevo solo se pinta ese
// (y el anterior, que deja de ser el último). En reuniones de 1-2 h hay cientos de
// filas y re-pintarlas todas en cada fragmento era lo que pesaba.
export const TranscriptRow = memo(function TranscriptRow({ seg, isLast }: { seg: TranscriptSegment; isLast: boolean }) {
  const sp = SPEAKER_STYLES[seg.speaker ?? 'null'] ?? SPEAKER_STYLES.meeting
  return (
    <div className={`transcript-line ${isLast ? 'active' : ''}`}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {fmtDuration(Math.round(seg.start_ms / 1000))}
      </span>
      {seg.speaker && <span className="text-xs font-semibold flex-shrink-0" style={{ color: sp.color }}>{sp.label}:</span>}
      <span className="text-sm break-words min-w-0" style={{ color: sp.color }}>{seg.text}</span>
    </div>
  )
})

// Panel derecho: la misma conversación, traducida, con el mismo tiempo y quién habla.
export const TranslationRow = memo(function TranslationRow({ seg, translated, isLast }: { seg: TranscriptSegment; translated: string | undefined; isLast: boolean }) {
  const sp = SPEAKER_STYLES[seg.speaker ?? 'null'] ?? SPEAKER_STYLES.meeting
  return (
    <div className={`transcript-line ${isLast ? 'active' : ''}`}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
        {fmtDuration(Math.round(seg.start_ms / 1000))}
      </span>
      {seg.speaker && <span className="text-xs font-semibold flex-shrink-0" style={{ color: sp.color }}>{sp.label}:</span>}
      {translated
        ? <span className="text-sm break-words min-w-0" style={{ color: '#67E8F9' }}>{translated}</span>
        : <span className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>Traduciendo…</span>}
    </div>
  )
})

// «Verificado en internet» (PRP-004). El resultado se muestra tal cual, con sus fuentes y las
// sugerencias de Google: así lo piden los términos del grounding con Google Search.
function ResearchBlock({ research }: { research: NonNullable<CopilotAnswer['research']> }) {
  if (research.status === 'loading') {
    return <p className="text-xs animate-pulse" style={{ color: '#67E8F9' }}>🔎 Buscando en internet (solo la pregunta técnica, sin datos de la reunión)…</p>
  }
  if (research.status === 'error') return <p className="text-xs" style={{ color: '#FBBF24' }}>{research.error}</p>
  return (
    <div className="rounded-lg p-2.5 space-y-1.5" style={{ background: 'rgb(34 211 238/0.07)', border: '1px solid rgb(34 211 238/0.3)' }}>
      <p className="text-[11px] font-semibold" style={{ color: '#67E8F9' }}>
        Verificado en internet{research.ms ? ` · ${(research.ms / 1000).toFixed(1)} s` : ''}
      </p>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Búsqueda: «{research.query}»</p>
      <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{research.text}</p>
      {!!research.sources?.length && (
        <ul className="space-y-0.5">
          {research.sources.map(s => (
            <li key={s.url} className="text-xs truncate">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#818CF8' }}>{s.title}</a>
              {s.domain && s.domain !== s.title.toLowerCase() && <span style={{ color: 'var(--color-text-muted)' }}> · {s.domain}</span>}
            </li>
          ))}
        </ul>
      )}
      {research.suggestionsHtml && (
        // Sin scripts; los enlaces abren en otra pestaña.
        <iframe title="Sugerencias de Google" sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<base target="_blank">${research.suggestionsHtml}`} className="w-full h-16 border-0 rounded" />
      )}
    </div>
  )
}

export const AnswerCard = memo(function AnswerCard({ answer, onResearch }: { answer: CopilotAnswer; onResearch: (a: CopilotAnswer) => void }) {
  const [copied, setCopied] = useState(false)
  const streaming = answer.status === 'streaming'
  const isContext = answer.trigger === 'context'
  return (
    <div className="suggestion-card type-reply animate-slide-up space-y-1.5">
      <p className="text-[11px] line-clamp-2" style={{ color: isContext ? '#67E8F9' : 'var(--color-text-muted)' }}>
        {TRIGGER_LABEL[answer.trigger]}{answer.question ? ` · ${answer.question}` : ''}
      </p>
      {isContext && answer.status === 'done' && answer.points?.length ? (
        <ul className="space-y-1 text-sm text-white leading-relaxed list-disc pl-4">
          {answer.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap"
          style={answer.status === 'error' ? { color: '#F87171' } : undefined}>
          {answer.text || (streaming ? (isContext ? 'Leyendo lo último de la reunión…' : 'Thinking…') : '')}
          {streaming && answer.text && <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle animate-pulse bg-indigo-300" />}
        </p>
      )}
      {answer.status === 'done' && (
        <div className="flex justify-end gap-3">
          {!isContext && (!answer.research || answer.research.status === 'error') && (
            <button onClick={() => onResearch(answer)} title="Busca en internet solo la pregunta técnica, sin nombres ni datos de la reunión"
              className="text-xs opacity-70 hover:opacity-100 transition-opacity" style={{ color: '#67E8F9' }}>
              🔎 Investigar
            </button>
          )}
          <button onClick={() => { navigator.clipboard.writeText(answer.text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="text-xs opacity-60 hover:opacity-100 transition-opacity" style={{ color: '#818CF8' }}>
            {copied ? 'Copiado ✓' : 'Copiar ↗'}
          </button>
        </div>
      )}
      {answer.research && <ResearchBlock research={answer.research} />}
    </div>
  )
})

// Lo que el Copiloto tiene cargado de esta reunión: documentos completos y de qué trata.
export function MeetingContextCard({ ctx, defaultOpen }: { ctx: MeetingContextInfo; defaultOpen: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? defaultOpen
  const kchars = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
  if (ctx.status === 'loading') {
    return <div className="p-3 rounded-lg text-xs animate-pulse" style={{ background: 'rgb(99 102 241/0.08)', border: '1px solid rgb(99 102 241/0.25)', color: '#A5B4FC' }}>
      📄 Cargando tus documentos para esta reunión…
    </div>
  }
  if (ctx.status === 'error') {
    return <div className="p-3 rounded-lg text-xs" style={{ background: 'rgb(245 158 11/0.08)', border: '1px solid rgb(245 158 11/0.3)', color: '#FBBF24' }}>
      No se pudo preparar el contexto. El Copiloto buscará en tus documentos al responder.
    </div>
  }
  if (!ctx.docs.length) {
    return <p className="p-3 rounded-lg text-xs" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
      Sin documentos activos. Súbelos en <Link href="/documents" className="underline">Documentos</Link> para que el Copiloto los use.
    </p>
  }
  return (
    <div className="rounded-lg text-xs" style={{ background: 'rgb(99 102 241/0.08)', border: '1px solid rgb(99 102 241/0.25)' }}>
      <button onClick={() => setOpen(!isOpen)} className="w-full flex items-center justify-between gap-2 p-3 text-left" aria-expanded={isOpen}>
        <span className="font-semibold" style={{ color: '#A5B4FC' }}>📄 Contexto de la reunión · {ctx.docs.length} doc{ctx.docs.length > 1 ? 's' : ''} completos</span>
        <span style={{ color: 'var(--color-text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 space-y-2">
          <ul className="space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {ctx.docs.map(d => <li key={d.name} className="truncate">· {d.name} <span style={{ color: 'var(--color-text-muted)' }}>({kchars(d.chars)} caracteres)</span></li>)}
          </ul>
          {ctx.brief && <p className="whitespace-pre-wrap leading-relaxed text-white/90">{ctx.brief}</p>}
        </div>
      )}
    </div>
  )
}
