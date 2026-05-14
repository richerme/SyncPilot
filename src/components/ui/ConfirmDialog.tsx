'use client'

import { useEffect } from 'react'

interface Props {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  variant = 'danger', busy = false,
  onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={() => { if (!busy) onCancel() }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-6 animate-fade-in"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-surface-border)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: variant === 'danger' ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
              color: variant === 'danger' ? '#EF4444' : '#818CF8',
            }}>
            {variant === 'danger' ? (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.354a15.001 15.001 0 01-7.486-6.482M9 18.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-title" className="text-base font-bold text-white leading-tight">{title}</h2>
            {description && (
              <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={busy}
            className="text-sm font-medium px-4 py-2 rounded-lg transition-all disabled:opacity-50"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="text-sm font-semibold px-4 py-2 rounded-lg transition-all disabled:opacity-50"
            style={{
              background: variant === 'danger' ? '#EF4444' : '#6366F1',
              color: 'white',
            }}>
            {busy ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="60 30" />
                </svg>
                Procesando…
              </span>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
