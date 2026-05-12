'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, FileText,
  Wrench, DollarSign, Settings, LogOut,
  Menu, X, HardHat, Sparkles, BarChart3, Users2,
  FolderOpen, ClipboardCheck, MessageSquare, FileBarChart, ShieldCheck, Megaphone, Target, ScrollText, GitBranch
} from 'lucide-react'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useUnreadCount } from '@/hooks/useMessages'

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { data: unreadCount = 0 } = useUnreadCount()

  // 1. DEFINE MENU ITEMS WITH PERMISSIONS
  // allowedRoles: null = Everyone, or specific list ['Admin', 'Maintenance']
  const menuItems = [
    { 
      name: 'Dashboard', 
      href: '/admin', 
      icon: LayoutDashboard,
      allowedRoles: ['Admin', 'Property Manager'] // Maintenance cannot see Main Dashboard
    },
    { 
      name: 'Residents', 
      href: '/admin/tenants', 
      icon: Users,
      allowedRoles: ['Admin', 'Property Manager']
    },
    { 
      name: 'Leases',
      href: '/admin/leases',
      icon: FileText,
      allowedRoles: ['Admin', 'Property Manager', 'Accounting']
    },
    { 
      name: 'Work Orders', 
      href: '/admin/maintenance', 
      icon: Wrench,
      allowedRoles: ['Admin', 'Property Manager', 'Maintenance'] // Everyone sees this
    },
    {
      name: 'Finance',
      href: '/admin/finance',
      icon: DollarSign,
      allowedRoles: ['Admin', 'Accounting']   // PM removed — separation of duties
    },
    {
      name: 'Vendors',
      href: '/admin/vendors',
      icon: HardHat,
      allowedRoles: ['Admin', 'Property Manager', 'Accounting']
    },
    {
      name: 'Owners',
      href: '/admin/owners',
      icon: Users2,
      allowedRoles: ['Admin']   // PM removed — owner relations handled by admin/accounting
    },
    {
      name: 'Documents',
      href: '/admin/documents',
      icon: FolderOpen,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'Inspections',
      href: '/admin/inspections',
      icon: ClipboardCheck,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'Compliance',
      href: '/admin/compliance',
      icon: ShieldCheck,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'Messages',
      href: '/admin/messages',
      icon: MessageSquare,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'Listings',
      href: '/admin/listings/syndication',
      icon: Megaphone,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'Leasing CRM',
      href: '/admin/leasing-crm',
      icon: Target,
      allowedRoles: ['Admin', 'Property Manager']
    },
    {
      name: 'AI Audit',
      href: '/admin/audit',
      icon: Sparkles,
      allowedRoles: ['Admin']   // PM removed — admin oversight tool
    },
    {
      name: 'Analytics',
      href: '/admin/analytics/scorecard',
      icon: BarChart3,
      allowedRoles: ['Admin']   // PM removed — portfolio-wide trends, admin scope
    },
    {
      name: 'Reports',
      href: '/admin/reports',
      icon: FileBarChart,
      allowedRoles: ['Admin', 'Property Manager', 'Accounting']
    },
    {
      name: 'Workflows',
      href: '/admin/settings/workflows',
      icon: GitBranch,
      allowedRoles: ['Admin']   // PM removed — middleware ADMIN_ONLY_PREFIXES blocks anyway, was a dead link for PMs
    },
    {
      name: 'Audit Trail',
      href: '/admin/settings/audit-log',
      icon: ScrollText,
      allowedRoles: ['Admin'] // Only Super Admin
    },
    {
      name: 'Settings',
      href: '/admin/settings',
      icon: Settings,
      allowedRoles: ['Admin'] // Only Super Admin
    },
  ]

  // 2. FETCH ROLE ONCE on mount (not on every route change)
  useEffect(() => {
    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      setRole(profile?.role || 'Resident')
      setLoading(false)
    }
    fetchRole()
  }, [])

  // 3. ENFORCE SECURITY REDIRECTS on route change (uses cached role)
  useEffect(() => {
    if (!role) return

    if (role === 'Maintenance') {
      if (!pathname.startsWith('/admin/maintenance')) {
        router.replace('/admin/maintenance')
      }
    }

    if (role === 'Accounting') {
      const isFinancePage = pathname.startsWith('/admin/finance') ||
        pathname.startsWith('/admin/settlements') ||
        pathname.startsWith('/admin/payroll') ||
        pathname.startsWith('/admin/reports') ||
        pathname === '/admin'
      if (!isFinancePage) {
        router.replace('/admin/finance')
      }
    }
  }, [pathname, role, router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Filter the menu based on the Role
  const filteredMenu = menuItems.filter(item => {
    if (loading) return false
    if (!role) return false
    // If no specific roles defined, allow everyone
    if (!item.allowedRoles) return true
    // Otherwise check if user's role is in the allowed list
    return item.allowedRoles.includes(role)
  })

  return (
    <>
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
              RYLEXA<span className="text-emerald-500">.OS</span>
            </span>
          </div>

          {/* NAV ITEMS */}
          <nav className="flex-1 overflow-y-auto space-y-2">
            {loading ? (
               <div className="text-slate-600 text-xs font-bold uppercase tracking-widest px-4 animate-pulse">
                 Verifying Access...
               </div>
            ) : (
              filteredMenu.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
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
              })
            )}
          </nav>

          {/* USER INFO & LOGOUT */}
          <div className="pt-6 border-t border-slate-800">
             <div className="mb-4 px-2">
                <p className="text-xs font-bold text-white">{loading ? '...' : role}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">Logged In</p>
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
    </>
  )
}