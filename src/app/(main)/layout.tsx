import Sidebar from '@/components/layout/Sidebar'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sidebar-layout">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  )
}
