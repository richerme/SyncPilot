import Sidebar from '@/components/layout/Sidebar'
import RecordingStatusBar from '@/components/layout/RecordingStatusBar'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sidebar-layout">
      <Sidebar />
      <div className="main-content flex flex-col">
        <RecordingStatusBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
