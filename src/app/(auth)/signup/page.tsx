'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Error al registrarse')
      setLoading(false)
      return
    }

    await signIn('credentials', { email, password, redirect: false })
    router.push('/dashboard')
  }

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
          style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="9" width="13" height="9" rx="1.6" fill="white"/>
            <path d="M16 11.2 L21 9 L21 18 L16 15.8 Z" fill="white"/>
            <circle cx="9.5" cy="13.5" r="1.5" fill="#6366F1"/>
            <circle cx="14" cy="10.5" r="0.9" fill="#EF4444"/>
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gradient-sync">SyncPilot</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Crea tu cuenta gratis</p>
      </div>

      <div className="card p-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Nombre</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Tu nombre" required className="input-field" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com" required className="input-field" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres" required minLength={6} className="input-field" />
          </div>
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>
        <p className="text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium" style={{ color: '#818CF8' }}>Inicia sesión</Link>
        </p>
      </div>
    </div>
  )
}
