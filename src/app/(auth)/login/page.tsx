'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError('Email o contraseña incorrectos')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
          style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
          <svg width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gradient-sync">SyncPilot</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Inicia sesión en tu cuenta</p>
      </div>

      <div className="card p-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com" required className="input-field" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required minLength={6} className="input-field" />
          </div>
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? 'Iniciando...' : 'Iniciar sesión'}
          </button>
        </form>
        <p className="text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          ¿No tienes cuenta?{' '}
          <Link href="/signup" className="font-medium" style={{ color: '#818CF8' }}>Regístrate</Link>
        </p>
      </div>
    </div>
  )
}
