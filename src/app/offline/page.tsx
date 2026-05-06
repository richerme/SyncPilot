export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center p-8"
      style={{ background: 'var(--color-bg)' }}>
      <div className="text-6xl mb-4">⚡</div>
      <h1 className="text-xl font-bold text-white mb-2">Sin conexión</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        SyncPilot necesita conexión a internet para funcionar.
      </p>
      <a href="/dashboard" className="btn-primary px-6 py-2.5">Reintentar</a>
    </div>
  )
}
