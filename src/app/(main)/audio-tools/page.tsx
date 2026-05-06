import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import AudioToolsClient from './AudioToolsClient'

export const metadata = {
  title: 'Voice AI Tools — SyncPilot',
  description: 'Traducción de audio, detección de acento, análisis de reuniones y cancelación de ruido',
}

export default async function AudioToolsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return <AudioToolsClient userId={session.user.id} userName={session.user.name ?? 'Usuario'} />
}
