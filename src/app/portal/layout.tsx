'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  Home, Wrench, MessageSquare, FolderOpen, Settings,
  Bell, LogOut,
} from 'lucide-react'
import TenantAI from '@/components/TenantAI'
import AppAssistant from '@/components/AppAssistant'

const NAV_ITEMS = [
  { href: '/portal', label: 'Home', icon: Home },
  { href: '/portal/repairs', label: 'Repairs', icon: Wrench },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare },
  { href: '/portal/documents', label: 'Docs', icon: FolderOpen },
  { href: '/portal/settings', label: 'Settings', icon: Settings },
]

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch tenant + unit for TenantAI widget
      const { data: lease } = await supabase
        .from('leases')
        .select('tenant_id, unit_id')
        .eq('user_id', user.id)
        .eq('status', 'Active')
        .maybeSingle()

      if (lease) {
        setTenantId(lease.tenant_id)
        setUnitId(lease.unit_id)
      }

      // Fetch open ticket count for bell badge
      if (lease?.tenant_id) {
        const { count } = await supabase
          .from('work_orders')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', lease.tenant_id)
          .in('status', ['Open', 'In Progress'])

        setUnreadCount(count ?? 0)
      }
    }
    init()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isActive = (href: string) => {
    if (href === '/portal') return pathname === '/portal'
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 relative pb-20">
      {/* AI WIDGETS */}
      {tenantId && unitId && (
        <TenantAI tenantId={tenantId} unitId={unitId} />
      )}
      <AppAssistant position="bottom-24 left-4" />

      {/* STICKY HEADER */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <Link href="/portal" className="text-lg font-bold tracking-tight">
          RYLEXA<span className="text-blue-500">.OS</span>
        </Link>

        <div className="flex items-center gap-4">
          <Link href="/portal/repairs" className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
            )}
          </Link>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 hover:border-red-100 transition-colors shadow-sm"
          >
            <LogOut size={14} />
            Log Out
          </button>
        </div>
      </header>

      {/* PAGE CONTENT */}
      {children}

      {/* BOTTOM TAB BAR */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-20 safe-area-bottom">
        <div className="flex items-center justify-around max-w-lg mx-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-1 py-3 px-4 transition-colors ${
                  active
                    ? 'text-blue-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <span className={`text-[9px] font-bold uppercase tracking-wider ${active ? 'text-blue-600' : ''}`}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
