import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SyncPilot — Grabación e IA en Vivo',
  description: 'Graba reuniones, transcribe con IA y obtén sugerencias en tiempo real',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
