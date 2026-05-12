'use client'

import React, { useEffect, useState } from 'react'
import {
  Building2, Wrench, BarChart3, Banknote,
  LayoutGrid, ArrowUpRight, ShieldCheck,
  Map, Zap, ClipboardList
} from 'lucide-react'
import Link from 'next/link'
import ActivityFeed from '@/components/ActivityFeed'
import { supabase } from '@/lib/supabaseClient'

export default function AdminDashboard() {
  // Role-gate finance-related NavCards. PMs don't see Performance/Distributions
  // (separation of duties; matches the sidebar's PM exclusion of Finance).
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
        .then(({ data }) => setRole(data?.role ?? null))
    })
  }, [])
  const canSeeFinance = role !== 'Property Manager'   // null while loading → hidden until known

  return (
    <div className="max-w-7xl mx-auto space-y-12 p-6 animate-in fade-in duration-700">
      
      {/* 1. HERO SECTION */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-5xl font-black tracking-tighter text-slate-900 italic uppercase leading-none">
            Command <span className="text-emerald-600">Center</span>
          </h1>
          <p className="text-slate-400 font-bold text-xs tracking-[0.3em] mt-3 uppercase">
            Rylexa.OS • Portfolio Intelligence
          </p>
        </div>
        <div className="flex gap-3">
          <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100 flex items-center gap-2">
            <Zap size={12} fill="currentColor" /> System Live
          </div>
          <div className="px-4 py-2 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black uppercase tracking-widest border border-slate-200">
            v2.1.3-Stable
          </div>
        </div>
      </header>

      {/* 2. PRIMARY NAVIGATION GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <NavCard 
          href="/admin/properties"
          title="Regional Portfolio"
          description="View Reno & Carson City Assets"
          icon={<Building2 size={24} />}
          color="bg-slate-900"
          count="12 Assets"
        />

        <NavCard 
          href="/admin/maintenance"
          title="Maintenance Hub"
          description="Manage Work Orders & Vendors"
          icon={<Wrench size={24} />}
          color="bg-emerald-600"
          count="Active"
        />

        {/* Performance — Admin/Accounting only (PMs are excluded from finance pages) */}
        {canSeeFinance && (
          <NavCard
            href="/admin/finance"
            title="Performance"
            description="Executive Financial Audit"
            icon={<BarChart3 size={24} />}
            color="bg-blue-600"
            count="94% NOI"
          />
        )}

        {/* Distributions — Admin/Accounting only (PMs are denied at the middleware) */}
        {canSeeFinance && (
          <NavCard
            href="/admin/finance/distributions"
            title="Distributions"
            description="Execute Owner Payouts"
            icon={<Banknote size={24} />}
            color="bg-indigo-600"
            count="Ready"
          />
        )}
      </div>

      {/* 3. SECONDARY UTILITY SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEASING PIPELINE CARD */}
        <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-500 transition-all duration-500">
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div>
              <div className="flex justify-between items-start mb-6">
                <div className="p-4 rounded-2xl bg-slate-50 text-slate-900 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                  <ClipboardList size={28} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Leasing Pipeline</span>
              </div>
              <h3 className="text-3xl font-black italic tracking-tighter text-slate-900 uppercase">Incoming Applications</h3>
              <p className="text-slate-500 font-medium mt-2 max-w-md">
                Review resident screenings, credit reports, and employer verifications for pending units.
              </p>
            </div>
            <div className="mt-10 flex gap-4">
               {/* UPDATED LINKS for Leasing */}
               <Link href="/admin/applications">
                 <button className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all">
                   Open Applications
                 </button>
               </Link>
               <Link href="/admin/leases">
                 <button className="px-8 py-3 bg-slate-100 text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-colors">
                   Lease Archive
                 </button>
               </Link>
            </div>
          </div>
          <LayoutGrid className="absolute -right-12 -bottom-12 text-slate-50 pointer-events-none" size={240} />
        </div>

        {/* SYSTEM STATUS SIDEBAR */}
        <div className="space-y-6">
          <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
            <ShieldCheck className="absolute -right-4 -top-4 opacity-20" size={120} />
            <div className="relative z-10">
              <p className="text-[10px] font-black uppercase text-emerald-200 tracking-widest mb-6">Compliance Audit</p>
              <h4 className="text-2xl font-black italic leading-tight mb-4">Portfolios Are 100% Compliant</h4>
              <p className="text-emerald-100 text-xs font-bold">Next audit scheduled for Feb 15th.</p>
            </div>
          </div>

          <Link href="/admin/portfolio-map" className="block">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 flex items-center gap-5 group cursor-pointer hover:bg-slate-50 transition-colors">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                 <Map size={24} />
              </div>
              <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Interactive Map</p>
                 <p className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors">Explore Northern NV</p>
              </div>
            </div>
          </Link>
        </div>

      </div>

      {/* 4. LIVE ACTIVITY FEED */}
      <div className="max-h-[500px]">
        <ActivityFeed />
      </div>
    </div>
  )
}

// Typed Interface for NavCard
interface NavCardProps {
  href: string
  title: string
  description: string
  icon: React.ReactNode
  color: string
  count: string
}

function NavCard({ href, title, description, icon, color, count }: NavCardProps) {
  return (
    <Link href={href} className="block group">
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm group-hover:shadow-2xl group-hover:border-emerald-500 group-hover:-translate-y-2 transition-all duration-500 h-full flex flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className={`w-14 h-14 ${color} text-white rounded-2xl flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform duration-500`}>
            {icon}
          </div>
          <h3 className="text-xl font-black italic tracking-tighter text-slate-900 uppercase group-hover:text-emerald-600 transition-colors">
            {title}
          </h3>
          <p className="text-slate-400 font-bold text-[10px] uppercase leading-tight mt-2">
            {description}
          </p>
        </div>
        
        <div className="mt-8 flex items-center justify-between relative z-10">
           <span className="text-[10px] font-black px-3 py-1 bg-slate-50 text-slate-400 rounded-full group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
             {count}
           </span>
           <ArrowUpRight size={18} className="text-slate-200 group-hover:text-emerald-500 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all" />
        </div>
      </div>
    </Link>
  )
}