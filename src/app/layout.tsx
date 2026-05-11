import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SyncPilot — Grabación e IA en Vivo',
  description: 'Graba reuniones, transcribe con IA y obtén sugerencias en tiempo real',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.svg', type: 'image/svg+xml', sizes: '192x192' },
    ],
    apple: '/icons/icon-192.svg',
    shortcut: '/favicon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SyncPilot',
  },
}

export const viewport: Viewport = {
  themeColor: '#6366F1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
