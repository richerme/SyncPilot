'use client'

import { useState, useEffect, useCallback } from 'react'

interface Document {
  id: string; name: string; fileType: string; isActive: boolean; createdAt: string; fileSizeBytes: number | null
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const loadDocs = useCallback(async () => {
    const res = await fetch('/api/documents')
    if (res.ok) { const data = await res.json(); setDocs(data.documents) }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')

    const form = new FormData()
    form.append('file', file)

    const res = await fetch('/api/documents', { method: 'POST', body: form })
    setUploading(false)

    if (res.ok) { await loadDocs() }
    else { const d = await res.json(); setError(d.error ?? 'Error al subir') }

    e.target.value = ''
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (res.ok) setDocs(prev => prev.filter(d => d.id !== id))
  }

  async function handleToggle(id: string, current: boolean) {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    if (res.ok) setDocs(prev => prev.map(d => d.id === id ? { ...d, isActive: !current } : d))
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-display-xs font-bold text-white">Documentos de Contexto</h1>
          <p className="text-body-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Sube PDFs o TXTs para que la IA los use como referencia durante tus reuniones en vivo.
          </p>
        </div>
        <label className="btn-primary cursor-pointer flex items-center gap-2 px-4 py-2.5">
          {uploading ? (
            <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="60 30" /></svg>
              Subiendo...</>
          ) : (
            <><svg width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Subir documento</>
          )}
          <input type="file" accept=".pdf,.txt,.md,.docx" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {error && (
        <div className="rounded-lg p-3 text-sm"
          style={{ background: 'rgb(239 68 68/0.1)', border: '1px solid rgb(239 68 68/0.3)', color: '#F87171' }}>
          {error}
        </div>
      )}

      {docs.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">📄</div>
          <h2 className="text-lg font-semibold text-white mb-2">Sin documentos</h2>
          <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Sube documentos PDF o TXT para que la IA los use como referencia durante tus reuniones.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-lg"
                style={{ background: 'rgba(99,102,241,0.15)' }}>
                {doc.fileType === 'pdf' ? '📑' : '📝'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{doc.name}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {doc.fileType.toUpperCase()}{doc.fileSizeBytes ? ` · ${formatBytes(doc.fileSizeBytes)}` : ''}
                  {' · '}{new Date(doc.createdAt).toLocaleDateString('es')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(doc.id, doc.isActive)}
                  className="text-xs px-3 py-1 rounded-lg font-medium transition-all"
                  style={{
                    background: doc.isActive ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
                    color: doc.isActive ? '#10B981' : 'var(--color-text-muted)',
                    border: `1px solid ${doc.isActive ? 'rgba(16,185,129,0.3)' : 'var(--color-surface-border)'}`,
                  }}>
                  {doc.isActive ? 'Activo' : 'Inactivo'}
                </button>
                <button onClick={() => handleDelete(doc.id)}
                  className="p-1.5 rounded-lg transition-all hover:bg-red-500/10"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
