'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard, FileText, Banknote, Building2,
  LogOut, Menu, X, FolderOpen, ClipboardCheck, MessageSquare
} from 'lucide-react'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'
import { useUnreadCount } from '@/hooks/useMessages'
import AppAssistant from '@/components/AppAssistant'

const navItems = [
  { name: 'Dashboard', href: '/owner-portal', icon: LayoutDashboard },
  { name: 'Properties', href: '/owner-portal/properties', icon: Building2 },
  { name: 'Statements', href: '/owner-portal/statements', icon: FileText },
  { name: 'Distributions', href: '/owner-portal/distributions', icon: Banknote },
  { name: 'Documents', href: '/owner-portal/documents', icon: FolderOpen },
  { name: 'Inspections', href: '/owner-portal/inspections', icon: ClipboardCheck },
  { name: 'Messages', href: '/owner-portal/messages', icon: MessageSquare },
]

export default function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* MOBILE TOGGLE */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden fixed top-3 safe-top-offset right-3 z-[60] w-11 h-11 bg-slate-900/90 backdrop-blur-md text-white rounded-2xl shadow-xl shadow-slate-900/20 flex items-center justify-center border border-white/10"
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
      >
        {isOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* SIDEBAR */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static
      `}>
        <div className="h-full flex flex-col p-6 safe-top safe-bottom">

          {/* LOGO */}
          <div className="flex items-center gap-3 mb-10 px-2">
            <Image src="/icons/rylexa-r.png" alt="Rylexa" width={32} height={32} className="rounded-lg" style={{ height: 'auto' }} />
            <span className="font-black italic text-xl tracking-tighter">
              RYLEXA<span className="text-emerald-500">.OWNER</span>
            </span>
          </div>

          {/* NAV */}
          <nav className="flex-1 overflow-y-auto space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/owner-portal' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative
                    ${isActive
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }
                  `}
                >
                  <item.icon size={18} className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-white'} />
                  <span className="font-bold text-xs uppercase tracking-wider">{item.name}</span>
                  {item.name === 'Messages' && unreadCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[9px] font-black min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* FOOTER */}
          <div className="pt-6 border-t border-slate-800">
            <div className="mb-4 px-2">
              <p className="text-xs font-bold text-white">Owner</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Portal Access</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all"
            >
              <LogOut size={18} />
              <span className="font-bold text-xs uppercase tracking-wider">Sign Out</span>
            </button>
          </div>

        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto w-full relative pt-16 md:pt-0 safe-top">
        {children}
      </main>

      {/* AI Navigation Assistant */}
      <AppAssistant />
    </div>
  )
}
