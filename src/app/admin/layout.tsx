import AdminSidebar from '@/components/AdminSidebar'
import AppAssistant from '@/components/AppAssistant'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar Component (Handles its own mobile visibility) */}
      <AdminSidebar />

      {/* Main Content Area */}
      {/* Sidebar is md:static inside flex, so flex-1 handles spacing automatically */}
      <main id="main-content" className="flex-1 overflow-y-auto w-full relative pt-16 md:pt-0 safe-top">
        {children}
      </main>

      {/* AI Navigation Assistant */}
      <AppAssistant />
    </div>
  )
}