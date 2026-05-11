'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  TrendingUp, Building2, BarChart3,
  Loader2, ArrowLeft, Activity,
  DollarSign, ArrowUpRight, ArrowDownRight,
  ShieldCheck, Landmark
} from 'lucide-react'
import Link from 'next/link'

export default function PerformanceScorecard() {

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchPerformanceData() {
      setLoading(true)
      setError(null)
      
      try {
        // 1. Fetch Properties and Unit IDs (Fixed: counts units locally to avoid 400 error)
        const { data: propData, error: propError } = await supabase
          .from('properties')
          .select('id, name, city, units(id)')
        
        if (propError) throw propError

        // 2. Fetch Financials from GL-based RPC (YTD)
        const ytdStart = `${new Date().getFullYear()}-01-01`
        const ytdEnd = new Date().toISOString().split('T')[0]
        const { data: pnlData, error: pnlError } = await supabase
          .rpc('get_profit_and_loss', { p_start_date: ytdStart, p_end_date: ytdEnd })

        if (pnlError) throw pnlError

        // 3. Merging logic to align financials with property assets
        if (propData) {
          const merged = propData.map(p => {
            const financials = pnlData?.find((f: any) => f.property_id === p.id) || {
              net_operating_income: 0,
              total_income: 0,
              total_expenses: 0
            }

            const revenue = Number(financials.total_income ?? 0)
            const noi = Number(financials.net_operating_income ?? 0)

            return {
              id: p.id,
              name: p.name,
              city: p.city,
              unitCount: p.units?.length ?? 0,
              noi: noi,
              revenue: revenue,
              expenses: Number(financials.total_expenses ?? 0),
              margin: revenue > 0 ? (noi / revenue) * 100 : 0
            }
          })
          setStats(merged)
        }
      } catch (err: any) {
        console.error("Scorecard Audit Failure:", err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchPerformanceData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Portfolio Aggregates
  const portfolioNoi = stats.reduce((acc, curr) => acc + curr.noi, 0)
  const portfolioRevenue = stats.reduce((acc, curr) => acc + curr.revenue, 0)
  const avgMargin = stats.length > 0 ? stats.reduce((acc, curr) => acc + curr.margin, 0) / stats.length : 0

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Loader2 className="animate-spin text-emerald-500" size={40} />
      <p className="text-slate-400 font-black uppercase text-[10px] tracking-widest italic">Calculating Regional Performance...</p>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto space-y-10 p-6 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 italic uppercase">Performance Scorecard</h1>
          <p className="text-slate-500 font-bold text-xs tracking-[0.2em] mt-1 uppercase text-emerald-600 font-black">Regional Asset Audit</p>
        </div>
        <Link href="/admin" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold transition-all group">
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> BACK TO DASHBOARD
        </Link>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 p-6 rounded-2xl flex items-center gap-4 text-red-700">
          <Activity size={24} />
          <p className="font-bold font-mono text-xs italic uppercase tracking-tighter">Sync Warning: {error}</p>
        </div>
      )}

      {/* KPI SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard 
          label="Portfolio NOI" 
          value={`$${portfolioNoi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
          trend="+5.8%" 
          icon={<Landmark size={20} />} 
          isPositive={true}
        />
        <MetricCard 
          label="Gross Revenue" 
          value={`$${portfolioRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
          trend="Target Met" 
          icon={<TrendingUp size={20} />} 
          isPositive={true}
        />
        <MetricCard 
          label="Avg. Operating Margin" 
          value={`${avgMargin.toFixed(1)}%`} 
          trend="Healthy" 
          icon={<ShieldCheck size={20} />} 
          isPositive={true}
        />
      </div>

      {/* DETAILED ASSET ANALYSIS */}
      <div className="bg-white rounded-[3rem] border border-slate-200 shadow-xl overflow-hidden">
        <div className="p-10 border-b border-slate-100 bg-slate-50/40">
           <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
              <BarChart3 size={20} className="text-emerald-500" /> Executive Asset Yield
           </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-10 py-6">Property</th>
                <th className="px-10 py-6">Total Income</th>
                <th className="px-10 py-6">Operational Expense</th>
                <th className="px-10 py-6">Net Income (NOI)</th>
                <th className="px-10 py-6 text-right">Yield %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stats.map((item) => (
                <tr key={item.id} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-10 py-8">
                    <p className="font-black text-slate-900 uppercase italic tracking-tighter text-lg leading-tight">{item.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      {item.city}, NV • {item.unitCount} Units
                    </p>
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-2 font-bold text-slate-700">
                      <ArrowUpRight size={14} className="text-emerald-500" />
                      ${item.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-2 font-bold text-slate-400">
                      <ArrowDownRight size={14} className="text-red-400 opacity-60" />
                      -${item.expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <span className="font-black text-emerald-600 text-lg tracking-tighter">
                      ${item.noi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                  <td className="px-10 py-8 text-right">
                    <span className="inline-block px-4 py-2 bg-slate-900 text-white rounded-2xl font-black text-xs italic shadow-lg shadow-slate-900/10">
                      {item.margin.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, trend, icon, isPositive }: any) {
  return (
    <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden group hover:border-emerald-500 transition-all duration-500">
      <div className="flex justify-between items-start mb-8">
        <div className={`p-4 rounded-2xl ${isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'} transition-colors group-hover:bg-emerald-500 group-hover:text-white`}>
          {icon}
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-slate-50 text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-700 transition-colors">
          {trend}
        </div>
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <h4 className="text-5xl font-black italic tracking-tighter text-slate-900 group-hover:text-emerald-600 transition-colors">{value}</h4>
    </div>
  )
}