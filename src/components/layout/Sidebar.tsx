'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV = [
  { href: '/dashboard',   label: 'Dashboard',      icon: '⚡' },
  { href: '/record',      label: 'Grabar',          icon: '⏺' },
  { href: '/recordings',  label: 'Mis Grabaciones', icon: '🎬' },
  { href: '/live',        label: 'IA en Vivo',      icon: '🧠' },
  { href: '/meetings',    label: 'Reuniones',       icon: '📋' },
  { href: '/documents',   label: 'Documentos',      icon: '📄' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="p-5 border-b" style={{ borderColor: 'var(--color-surface-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366F1, #06B6D4)' }}>
            <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="font-bold text-sm text-gradient-sync">SyncPilot</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}>
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t" style={{ borderColor: 'var(--color-surface-border)' }}>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="nav-link w-full text-left">
          <span className="text-base">🚪</span>
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
