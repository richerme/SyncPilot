'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV = [
  { href: '/dashboard',    label: 'Dashboard',        icon: '⚡' },
  { href: '/record',       label: 'Grabar',            icon: '⏺' },
  { href: '/recordings',   label: 'Mis Grabaciones',   icon: '🎬' },
  { href: '/live',         label: 'IA en Vivo',        icon: '🧠' },
  { href: '/meetings',     label: 'Reuniones',         icon: '📋' },
  { href: '/audio-tools',  label: 'Voice AI',          icon: '🎙️' },
  { href: '/documents',    label: 'Documentos',        icon: '📄' },
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              {/* Video camera + mic monogram */}
              <rect x="3" y="9" width="13" height="9" rx="1.6" fill="white"/>
              <path d="M16 11.2 L21 9 L21 18 L16 15.8 Z" fill="white"/>
              <circle cx="9.5" cy="13.5" r="1.5" fill="#6366F1"/>
              <circle cx="14" cy="10.5" r="0.9" fill="#EF4444"/>
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
            <span className="flex-1">{item.label}</span>
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
